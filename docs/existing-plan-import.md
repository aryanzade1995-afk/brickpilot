# Existing plan and measured-structure entry

Open `/workspace/existing` and choose a rough drawing, manual measurements, or the existing site-photo detector. The planner and downstream routes stay the same.

## Drawing and manual review

The drawing reader submits PNG/JPEG/WebP images up to 5 MB to the existing Gemini Web bridge through `/api/existing-plan/read`. It proposes normalized geometry and only reads labelled construction sizes. Unsupported/unclear geometry belongs in review notes. The browser validates the response schema. There is no mock drawing or generated replacement image.

Confirm the real image width/depth, plot dimensions, image-origin offsets from the plot's left/rear boundaries and floor height. Apply the image scale before editing coordinates. The tracing can overlay the original drawing. All positions in the tables are measured from that same origin in metres. The drawing must be aligned with the entrance/road at the bottom; the road-side selector records its real compass bearing.

Enter missing columns and footings individually. A regular-grid shortcut accepts explicit counts, centre-to-centre gaps and square column size. It replaces columns and beam connections only after Apply. Connecting every adjacent pair with existing beams is an explicit opt-in requiring measured beam width. Individual corrections remain editable.

Columns need measured square sizes; beams connect numbered columns and need widths; walls need endpoints and thickness; openings need measured widths/head heights and window sill heights. Door swing and leaf, emergency exit and stair starting side are editable. Empty, invalid or unconfirmed required dimensions block generation. Missing supports are not inferred from the image; the user confirms the full support inventory.

## Preservation and validation

Foundation mode generates rooms around the confirmed locked structure. Surveyed origin offsets, irregular column coordinates, built beam connections and existing walls are preserved. Rooms intersecting built walls are conflicts. Candidate selection checks both ordinary plan rules and existing-structure constraints.

House-layout mode imports the confirmed ground-floor rooms, walls and openings verbatim. The measured plan lives on the existing-structure record, so normal navigation and saved replay cannot replace it with a generated room arrangement. The ordinary Design, BuildingModel, Blender-export, interior and cost flow consumes that same geometry. Ordinary rule failures keep the 3D continuation disabled.

Current traced-house input supports one ground floor, rectangular room sections, horizontal/vertical walls and square columns. Additional floors need separate measured plans and stair information; neither additional floors nor irregular room outlines are fabricated. Roof-terrace, circulation, opening clearance and other normal planning rules still apply. Foundation mode retains the existing multi-floor planner.

## Drawing reader (runs on this computer)

Start page → **Start from my plan** opens `/workspace/existing?input=drawing`. The uploaded sketch is read locally, with no cloud service:

1. A local vision model (Ollama, `qwen2.5vl:3b`, about 3 GB, `ollama pull qwen2.5vl:3b`) reads the lettering: room names, dimension labels (30', 9.1 m) and notes such as MAIN GATE or ROAD.
2. `server/sketch/read_sketch.py` (Python + OpenCV) traces the drawing itself: the double-line walls, the rooms they enclose, door swings (the quarter-circle arc marks each doorway and its swing side), windows on the outer walls, and the dimension lines. Lengths are paired with the horizontal and vertical dimension lines by the scale they imply, because the model's text positions are not precise. Open spaces holding several names (lobby + drawing room) are split into rectangles; a sketch line drawn slightly off its neighbour is lined up instead of leaving an unusable sliver, and the review notes say so.
3. A room name or dimension the first look missed is read again from a crop of just that spot.

The draft is measured from the house's outer wall lines. On the review screen every blank is filled with a standard value (`SURVEY_DEFAULTS` in `src/lib/existing/survey.ts`): 3.0 m floor height, 230 mm outer / 115 mm inner walls, 230 mm columns at wall corners and junctions, 2.1 m door heads, 0.9 m window sills, and a plot sized from the default setbacks plus room for the walls. `withDefaults` also makes the tracing consistent: walls follow the room edges, each door sits on the edge its two rooms share, windows on one room's outer edge, openings never overlap, and a door swings to whichever side fits (otherwise it is an open doorway). **Build the 2D plan** then runs the normal checks; a confirmed traced plan treats new-design preferences (bedroom privacy, wide archways, entrance size, roof-terrace stair) as advice, while geometry, overlaps, reachability and 3D placement still block.

Settings: `OLLAMA_URL` (default `http://127.0.0.1:11434`), `SKETCH_VLM` (default `qwen2.5vl:3b`), `SKETCH_PYTHON`, and `PLAN_READER=gemini-web` to use the Gemini Web bridge instead. If the reader is unavailable the page says so and the rooms can be entered by hand.

## Verification

Focused tests cover blank/invalid dimensions, unconfirmed input, missing supports and sizes, scale calibration, non-snapped irregular columns, built beams/walls, room-wall conflicts, tracing geometry, saved replay, normal BuildingModel assembly, Blender input and cost generation. Existing planning, room-editing and studio replay regression tests also passed. The browser was checked for missing-input prompts, measured foundation generation and re-editing.

Run `node --experimental-strip-types --test scripts/test-existing.mjs scripts/test-existing-survey.mjs scripts/test-existing-survey-handoff.mjs scripts/test-sketch-reader.mjs` (the sketch tests trace two fixture drawings with saved model labels, so Ollama is not needed). These tests are included in the main project test script.
