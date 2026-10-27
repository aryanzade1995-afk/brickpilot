# Ventilation and raised, ramped entry

Implemented 2026-10-27 after pulling `origin/main` (`9a577da`).

## User controls

- Utilities → Ventilation: choose North, East, South or West. “All four sides”
  cycles independent wind-direction illustrations every seven seconds; it does
  not imply four opposing weather winds occur simultaneously. Pause, animation
  speed, assumed-open internal doors and see-through inspection are available.
- Brief → Levels: 450 / 600 / 900 mm above site ground. This writes the existing
  `specs.overrides['plinth-height']`, shared with Finishes & Cost and Blender.
- Brief → Entry: Wheelchair entry ramp. A clear flight/landing arrangement is
  proposed where it fits, otherwise the exact failure remains a review state.

## Air is an illustration, not CFD

`ventilation.ts` uses BuildingModel floors, room rectangles, exterior window
records and the actual connecting doorway graph. It stays on a single floor and
does not create vents, openings or cross-wall passages. Room visibility paths
avoid represented columns/shafts. No connected opposite opening means no trace.
Window operability is unknown; windows and enabled internal doors are explicitly
assumed open. Stair volumes, furniture, pressure, turbulence and external weather
are not simulated. Blue-to-orange wisps explain cooler incoming / warmer
outgoing air; they are not computed temperatures or an air-change/comfort claim.
Plan cardinal sides are local drawing axes, not a surveyed compass bearing.

The existing accepted villa canvas is reused. Short feathered, gently fluttering wisps use one shared ribbon geometry and a
GPU path texture, with no static routes, pipe-like tubes or cone arrows. Path
solving and conservative curve rounding occur only when inputs change. Only a
time uniform changes each animation frame; the soft wisp width is exaggerated
for readability and is not a physical flow envelope; demand rendering is retained; reduced-motion
users start paused. Settings are optional version-1 data in Brief and survive
the existing project save/load flow. They are excluded from geometryBrief and
architectural seed inputs.

## Ramp geometry and height

Ground-floor finished level remains model Z=0. Site grade is below it by the
selected plinth height, as in the existing structural/Blender pipeline. This
preserves room and stair elevations. A raised floor is not flood certification:
road, drainage, historical flood and survey levels still require verification.

`entryRamp.ts` creates canonical closed wedge meshes, level landings, supported
dual-height rails, posts and edge protection. It tries a straight outward,
sideways, then a two-flight return arrangement. Every deck envelope stays on the
site and clear of recorded occupied rooms, sized columns, pool, parking and
driveway. A compatible verandah can accommodate the top landing. The top
landing reaches the actual entry threshold. The lower landing joins the existing
modelled paving top (site.py: grade +10 +40 mm), not a guessed surveyed datum.
Rain/drain tank placement reserves the ramp footprint.

Dimensions are traceable concept assumptions: CPWD/MoUD 2016 Harmonised
Guidelines, Table 7-1 / §7.2.2 (rise-dependent gradients and run intervals),
§7.2.5 (level landings), §5.9.2 (grip dimensions). The implementation uses 1800 mm
clear width, 2000 mm landings and 2000 mm supported decks. Slope is 1:12 for the
supported smaller rise, 1:15 above 750 mm; long runs split with level landings.
The engineering basis lives separately in `RAMP_BASIS` with source/edition/date.

- Verified dimension source: https://www.cpwd.gov.in/Publication/Harmonisedguidelinesdreleasedon23rdMarch2016.pdf
- Current 2021 guidance publication: https://depwd.gov.in/en/document/harmonised-guidelines-standards-for-universal-accessibility-in-india-2021/

This is not a statement of compliance with the current local requirements. The
2021 linked PDF was unavailable during verification; no clauses from it are
invented. Gate-to-ramp approach continuity, manoeuvring, threshold detailing,
handrail terminations, grip, surface drainage, roof/post clearances and structure
need site review. Ramp construction is explicitly not yet itemised in the BOQ.
The plinth/filling cost continues through existing quantities.

Blender consumes the same vertices, indices and rail endpoints, with no Python
placement algorithm. The live Massing overlay and live GLB export reuse them;
tagged baked ramps are stripped before attaching that overlay once. Raw Blender
and GLB downloads contain a changed ramp only after the model is regenerated.
The accepted Blender walkthrough sees that exported geometry through its normal
mesh/collision path. The older simplified shell exporter has no separate ramp
slope adapter; use the accepted Blender asset for this feature.

Changing plinth/ramp updates source structural metadata and BuildingModel while
preserving pinned seed and layout edits. The old exterior seed namespace is
recorded in optional Brief entry metadata so a save/reload cannot randomise the
villa facade. Real room/plot geometry edits clear that namespace. Old default
briefs retain their building identity, and Reset finishes keeps plinth choice.

## Verification

- `npm run test:ventilation`, `npm run test:entry-ramp`: four sides, blocked/
  missing apertures, door state, columns/shafts, floor levels, gradients, closed
  mesh winding, site fit/failure, old identities, pinned/layout preservation,
  persistence, cost setting and finish reset.
- Broader focused regression before the wisp-only refinement: 132 passed, two optional asset tests skipped.
- Blender 4.5.14: canonical vertex/closed-volume/rail/identity checks and GLB
  export passed; exported GLB parsed in Three.js with 48 source-tagged meshes.
- TypeScript and production build passed; existing Vite chunk-size warnings.
- An unrelated existing solar editor test expects a different Hindi translation
  of “Portrait” (`खड़ी व्यवस्था` vs current `पोर्ट्रेट`). No solar translations
  were changed by this feature.

No RTX 3050 frame-rate measurement or site engineering certification is claimed.

Final wisp refinement: 13 feature tests passed, focused lint clean, and the final production build passed. Live browser verification checked shader compilation, four-side selection and pause/resume.

Visibility refinement: camera-aware soft wisp width maintains an 8 px minimum half-width in the house overview, bounded when zooming in. Richer cool/warm colours, a moving fine highlight, fuller tapered opacity and bounded extra wisps improve legibility while retaining a single GPU draw. Width is a presentation halo, not a physical air-stream diameter.
