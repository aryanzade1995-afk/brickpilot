# Residential electrical planning

The utility viewer now derives a versioned electrical design from its existing floor,
symbols and canonical paths. It does not change the validated architecture or run a
new routing search. It preserves the other service layers and the live 3D wire paths.

## Files and integration

- `src/lib/utilities/electricalInputs.ts`: Zod-validated version 1 inputs. Missing
  voltage, watts, cable characteristics, factors, protection and measured values are
  `null`, not plausible-looking defaults.
- `electricalRules.ts`: reference metadata and the explicitly reviewed NBC subset.
  Keep edition, clause, units, applicability and verification date with every rule.
- `electricalDesign.ts`: inventory, per-room final-circuit proposals, dedicated
  appliance branches, topology, load/current/drop calculations and review results.
- `src/components/utilities/ElectricalWorkbench.tsx`: draft inputs, Apply/Cancel,
  appliance records, circuit schedule, commissioning evidence and review CSV.
- `drawingProject.ts`, `useUtilityDrawing.ts`: project/floor-scoped save, JSON
  import/export, 30-second session save and existing undo/redo. Old documents get
  unknown electrical inputs. Calculated results are rebuilt from source and inputs.
- `drawingSheets.ts`: the same schedule, inventory, checks and qualifications in
  vector PDF, SVG, PNG and printed sheet continuations. DXF keeps the canonical
  paths/symbols; it is a geometric exchange, not an electrical design certificate.

Legacy `electricalPlan()` sizes remain compatibility labels on the source proposal.
The new applied viewer never promotes them to selected cables/breakers: these are
displayed as Unspecified until entered. The old geyser socket's 16 A label is removed
from the applied presentation. No BOQ, cost, product selection, building identity or
accepted render is changed by these electrical inputs.

## Circuit allocation and inventory

Light/fan loads and their existing switch feeds are grouped by represented room.
General sockets are separated by room; geyser/AC/cooking/pump/washing-machine loads
or explicitly dedicated loads get separate proposed branches. This does not invent
an isolator or a new pathway. Inappropriate shared controls/terminals fail review.
Oversized circuits are reported rather than silently rerouted or fitted with a
larger breaker.

Every represented electrical endpoint is an inventory item. Its wattage is unknown
until a nameplate or a documented estimate is supplied. Socket maximum amperage,
room area, cooling capacity and cost are not appliance input power. An additional
appliance may replace one existing socket placeholder; it is not counted twice.
An appliance without a suitable endpoint stays unconnected and prevents a complete
DB assessment. This module does not assert that an unmodelled appliance is absent.

## Calculation basis

Supported final circuits are radial, line-neutral circuits. A three-phase service
requires an explicit phase per final circuit. Three-phase appliances, starting
current, harmonics, safety-source design and whole-house phase balance remain
external engineering tasks.

- Connected power sums known input watts only. A missing rating or its basis keeps
  the complete connected/design power unknown; the known subtotal is labelled.
- Design watts = connected watts × entered demand factor, with a method reference.
- Design current = design watts / (confirmed line-neutral volts × entered PF).
- Corrected capacity = entered base-table amperes × temperature × grouping × other
  factors. Cable material, section, insulation, installation conditions and source
  row must be supplied. There are no embedded guessed ampacity tables.
- Capacity check uses Ib ≤ In ≤ Iz. Separate overload-trip and breaking-capacity
  checks use the actual device data; they do not replace fault/disconnection studies.
- Route lengths use the existing 3D lift, including represented risers and drops
  through openings. Circuit total developed length and longest DB-to-load path are
  different quantities. Coincident paths from different circuits are not magically
  merged into one conductor or conduit takeoff.
- Voltage drop sums each segment's downstream demand current times its developed
  length and the supplied single-phase line/return mV/A/m coefficient. It is not
  doubled again. Worst terminal drop plus entered upstream consumer-terminal-to-DB
  drop is compared with the conditional NBC limit. A longer surveyed path adds a
  conservative full-current allowance; a shorter one is flagged and cannot reduce
  the model length. Coefficient operating conditions and route review are required.

The reviewed NBC 2016 subset includes mixed light/fan circuit limits in 5.4.4.3,
the separate dedicated-light limit, residential incomer residual-current guidance
in 5.4.4.1 and consumer-terminal voltage drop in 6.2. Applying these comparisons
requires designer confirmation of applicability. The code does not automatically
choose a conductor from the NBC's recommendatory dimensions.
The conditional minimum fixed copper section also checks the IS 732:2019
5.2.7.1 / Table 33 summary in RDSO Volume 2 and the applicable NBC equipment minimum.
Passing that minimum alone does not establish adequate cable sizing.

## Coordination and evidence

Checks reuse actual plan walls, openings, voids and columns and flag beam approach.
Door openings are not structural penetration approval. Reinforcement, foundations,
concealed services, conduit fill, junction access, bathroom zones and IP ratings
require a survey and reviewed installation details.

Service proximity uses a configurable **concept screening distance**, not a code
clearance. Source visual mounting heights are not verified elevations. Without
reviewed heights, plan proximity is Not Checked. Entered constant heights support
only a section-screening approximation; they do not verify full riser geometry or
water-leak exposure. Findings appear in the electrical review, without restoring
the retired generic clash/exclamation overlay or adding auto-rerouting.

Geometry signatures use stable key ordering and survive JSON round trips. Source
changes invalidate passing evidence while retaining input records for deliberate
review. Missing circuit IDs are listed as stale input. Recorded professional test
reports are distinguished from tests actually performed by Formstead (none).

## References and limits

Checked 22 October 2026:

- Official government-hosted NBC 2016 Volume II: the source URL is in
  `ELECTRICAL_SOURCES.nbc`; downloaded reference text is in the task outputs.
- BIS lists IS 732:2019, fourth revision, reviewed December 2024. Its detailed
  sizing/special-location tables are not imported here.
- CEA lists the 2023 safety regulations and a 2026 amendment. A consolidated
  amended text was not verified, so current statutory compliance stays unchecked.
- RDSO/CAMTECH LV protection Volume 2 supports overload coordination principles.
  It is engineering guidance, not a residential approval.
- MSEDCL's official application page provides a contractor D-1 test report.
  Supplier-specific requirements are conditional on confirming that supplier;
  Pune alone does not establish supply conditions or local jurisdiction.

Before construction, a competent electrical designer and licensed contractor must
complete cable-table selection, short-circuit withstand, disconnection, selectivity,
earthing/bonding, special-location design and commissioning under applicable rules.

## Tests

Run `npm run test:electrical-design` or `npm run test:utility-plan`. Tests cover
unknowns, dedicated allocations, current/derating, shared-feeder voltage drop,
invalid topology, missing phase/evidence, overloads, service levels, source changes,
production 3D parity, old-file migration and sheet/CSV delivery.
