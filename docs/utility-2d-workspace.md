# Utilities: 2D planning workspace

Utilities now opens directly on the source floor plan. It does not mount a WebGL canvas or offer a 3D view. Existing house walkthroughs and exterior viewers are separate and unchanged.

## User flow

1. Select a floor and enable a service. All four services start off; saved sessions can be deliberately restored.
2. Focus a room. Click a pipe, wire or service symbol to highlight its network. Electrical, water and alarm selections show their full service group, including sources outside the current room.
3. Enable Technical view for additional tags and room areas. Engineering inputs and review results are under **Technical settings & review**, below the drawing.
4. Open **Add or move service points** for switches, sockets, lights, fans, supply outlets, valves and supported fire devices. Coordinates are plan millimetres; mounting height is optional and stays unknown when blank. Click **Choose position on plan** or enter coordinates.
5. Moving a point withdraws attached source runs. It never reroutes them automatically. Added points remain unconnected. Manual connections use two endpoints in the same source service group and explicit orthogonal vertices. Each click-defined bend is an axis-snapped user instruction, not an automatic routing search. Numeric coordinates are also supported. Manual routes require professional structural, electrical, plumbing and fire review.
6. Drainage fixture, stack-base and outlet editing continues through the existing drainage workbench. Its sizing, slope, connectivity and missing-input checks are retained.
7. **Between floors** shows a floor-by-floor source inventory of stacks, DBs, supply inlets and fire panels. It is a schematic coordination aid, not a validated riser design: cross-floor connectivity and surveyed elevations are not supplied by the source. It deliberately does not join floors just because XY positions align. Imported single-floor snapshots show only their recorded floor.
8. **Drawing sheets** retains title blocks, revisions, annotations, scales and PDF/PNG/SVG/DXF exports. The floor-service inventory has its own SVG download. Selected service points, entered heights and qualifications appear in drawing schedules. Drawing exports use the edited utility model; JSON contains the source model plus explicit edits.

## State and scope

`DrawingDocument.planning` is versioned and validated by `planningSchema`. Older documents receive an empty planning record. Edits are scoped to project/floor storage, included in JSON/session saves and use the existing undo/redo document history. Initial visibility stays off. Old snapshots containing a 3D view preference are readable; the current workspace ignores that preference and always renders 2D.

`planningGeometryKey` blocks stale point edits after source geometry changes. Unknown heights do not become guessed mounts or service elevations. Explicit height annotations do not prove conduit/pipe levels. Moving fire devices invalidates their old coverage and loop state. Manual proposals do not modify the architectural plan, building identity, selected products or construction BOQ; procurement integration for newly added endpoints remains a separate task. Source utility quantities and edited drawing schedules must be professionally reconciled before purchase.

The existing per-floor utility generation and engineering modules remain in use. No automatic routing or rerouting feature was added. Legacy 3D utility geometry helpers are retained for old data/tests and existing elevation-based engineering calculations, but no utility 3D renderer is loaded by this page.

## Files

- `planning.ts`: validated manual point/route proposals and source-preserving replay.
- `UtilityPointEditor.tsx`: one shared manual editor with numeric and plan-click input.
- `risers.ts`, `UtilityRiserDiagram.tsx`: honest floor-service schematic and SVG export.
- `UtilityPlanViewer.tsx`: existing 2D SVG pipeline, filters, tracing, tooltips and drawing exports.
- `useUtilityDrawing.ts`: existing persistence/undo with per-project/floor point storage.

Verification: `npm run test:utility-plan`, `npm run build`.
