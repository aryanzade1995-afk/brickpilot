# Utility drawing sheets

Open **Utilities → Drawing sheets**. This extends the existing viewer. It does
not introduce routing, rerouting, automatic repairs or new building geometry.
Viewer layers, the clash engine, source architecture and priced BOQ remain
independent of drawing metadata and annotations.

## Sheets and scale

- A4, A3, A2 and A1, portrait/landscape; 1:50, 1:100 and 1:200.
- Source x/y, annotations and dimensions are millimetres. Paper coordinates are
  millimetres. `paperDistance = modelDistance / scaleDenominator`.
- Large plans tile without shrinking. Every tile has its own drawing number,
  frame, A–D / 1–4 references, title block, scale bar and plan-up arrow. Geographic
  north is explicitly unverified; road direction is not treated as north.
- Schedules, full revision registers and symbol legends continue onto additional
  pages if needed. Schedule/clash continuation pages are marked NTS.
- Revision summary sits directly above the bottom-right title block. Long
  project, client, drawing and reviewer fields wrap rather than disappear.
- The PDF must be printed at **actual size / 100%**, not printer “fit to page”.
  Preview zoom changes only the screen view. The 2 m scale bar verifies output.

## Annotations and revisions

Dimensions, text notes, leader arrows and scalloped revision clouds are a
separate, switchable annotations layer. Click plan points or enter X/Y in mm.
Clouds attach to the latest revision; create the revision first. Revision letters
continue A…Z, AA, AB…. Point placement ignores drag/pan gestures.

Auto dimensions show plan route lengths and straight fixture-to-stack distances.
They do not include hidden vertical drops, hydraulic sizing or installation
allowances and never replace BOQ quantities. Electrical schedules give connected
device counts; watts remain unknown. Drain tags show **slope unverified** because
no surveyed slope has been supplied. A note can record a designer's supplied value.

Locks prevent 2D item selection and annotation placement. The opacity controls
affect 2D drawings; they do not alter 3D geometry, electrical circuits or pipes.
Drawing/review undo histories stay separate; Ctrl+Z/Y follows the last edited
domain. Undo is visit-local, not a replacement for saved project versions.

## Exports

- **PDF**: native vector lines, polygons, circles and selectable text; exact page
  dimensions. Unicode text uses the bundled OFL Noto Sans Devanagari font when
  needed. No page screenshot is inserted into the PDF.
- **PNG**: selected page at 150/300 DPI, matching physical paper dimensions and
  a PNG `pHYs` DPI record. Large raster allocations have a friendly size guard.
- **SVG**: selected page, named groups, physical mm size, escaped user text,
  white page and self-contained vector content.
- **DXF**: AutoCAD 2000 ASCII model space, one unit = one mm. Source plan y-down
  becomes CAD y-up. Named service/wall/fixture/annotation layers, true colours,
  handles, entity subclasses and standard model/paper-space blocks. DXF exports
  actual whole-floor geometry, independent of viewer filters or sheet tiles;
  paper furniture is delivered in PDF/SVG. It is not a DWG or 3D villa export.
- **Export all sheets PDF**: every service, combined coordination, their required
  tiles/schedule continuations, then the current floor's clash report. All service
  layers are included even if hidden in the interactive view. It is a set for the
  selected floor; use the floor selector for another floor.

Schedules and sheet labels use standard English drawing terminology. Editable
names and notes support Unicode; workspace controls use English/Hindi/Marathi.
Font source/license: https://github.com/notofonts/noto-fonts (public/fonts/NOTO-OFL.txt).

## Save and restore

**Save project JSON** exports the complete current-floor Utility model, document
settings, layer preferences, routes, annotations, revisions, view preferences and
versioned clash review records. Loading validates format, size, finite coordinates,
orthogonal paths, object references, duplicate IDs and a source signature before
changing the viewer. The imported Utility model is a labelled snapshot; it never
replaces the accepted Formstead architecture or cost. **Return to live plan** is
available at any time.

Clashes are recalculated from loaded geometry, not trusted as imported results.
Reviews only apply to matching item/rule fingerprints. Thirty-second device-local
session autosave is scoped by project and floor, catches storage errors, and
offers Restore / Keep live plan on the next visit. Autosave waits while that choice
is pending. Title fields also persist locally. No cloud sync is implied.

## Extending a sheet size or title field

1. **New size**: add its short/long mm dimensions to `SHEET_SIZES` and its name to
   `settingsSchema.size` in `drawingProject.ts`. The picker, tiling, SVG, PNG, PDF
   and print sizing use these dimensions automatically. Review raster size limits.
2. **New title field**: add it to `settingsSchema` and `defaultDrawing`, add its
   labelled input in `DrawingSettingsDialog.tsx`, and add a field definition in
   `frame()` in `drawingSheets.ts`. JSON, SVG and vector PDF share that data.

Validation: `npm run test:utility-plan`, `npm run build`. The DXF output was also
read and audited with ezdxf: 263 model-space entities, zero errors/repairs on the
baseline fixture. This checks file structure, not engineering compliance.
