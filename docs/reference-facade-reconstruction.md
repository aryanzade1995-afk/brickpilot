# Reference facade reconstruction

Implemented in the existing Formstead workspace inside **2D plan** at `/workspace/plan#reference-facade`. This is a deterministic concept-modelling workflow with a real vision adapter, not exact 3D recovery from a photograph.

## Architecture and reused systems

The audited application already has a validated millimetre-based BuildingModel, deterministic planner, procedural facade/massing grammar, a cached accepted Blender GLB viewer, project/version storage, Node provider infrastructure and Blender process/export helpers. The old inspiration analysis supplied style preferences and could trigger replanning; this feature deliberately does not call that path.

```
Validated source plan + uploaded crop
    -> optional server-side multimodal analysis / explicit manual observations
    -> strict versioned ReferenceFacadeSpec
    -> deterministic solids + validation
    -> shared existing villa canvas + component editor
    -> aligned render comparison / bounded refinement
    -> reversible acceptance / existing Blender process / editable delivery
```

### New modules

| Files | Responsibility |
| --- | --- |
| `src/lib/reference/schema.ts` | Strict Zod version 1 schema; IDs, units, observations, uncertainty, parent relationships, edits and saved document. Explicit legacy pixel-coordinate migration. |
| `src/lib/reference/reconstruct.ts` | Real rectangular solids; source-frame mapping, shell/opening subtraction, frames, C frames, portals, fins, louvers, pergolas, balconies, screens, cladding and roof details; bounds, intersections, opening and anchor checks. |
| `src/lib/reference/comparison.ts` | Aligned camera, projected feature boxes, confidence-weighted IoU, software silhouette rasterization, edge matching and global luminance SSIM approximation, bounded candidate refinement. |
| `src/lib/reference/capture.ts` | Offscreen render of the actual shared scene at the reference crop aspect, without stretching the responsive viewer or scoring a different orbit; restores GPU state and selection. |
| `src/lib/reference/client.ts` | Image decoding/resizing, cropping, bounded upload and asynchronous job/cancellation client. |
| `src/state/reference.ts` | Separate persisted proposal and accepted snapshot, original toggle, undo/redo/reset; no planner, seed or cost writes. |
| `src/components/VillaSceneCanvas.tsx` | Extracted existing Massing canvas and accepted GLB rendering; shared prepared-geometry cache and per-instance material overrides. |
| `src/components/reference/*` | Canonical solid layer, aligned camera and the existing study-model fallback. |
| `src/components/reference/ReferenceFacadeSection.tsx` | The integrated image/intent/edit/compare/accept/export workflow, responsive Formstead theme and numeric alternatives to drawing. |
| `server/reference-images.mjs` | JPEG/PNG/WebP content and dimension validation; hash-addressed image storage separate from project JSON. |
| `server/providers/reference-vision.mjs` | Gemini bridge or configurable multimodal chat provider; strict result parsing, timeout, cancellation and limited retry. No fabricated detections. |
| `server/reference-facades.mjs` | Validated source adapter, bounded queue, deterministic cache, real reconstruction/refinement/Blender jobs, whitelisted artifacts and source-GLB association. |
| `blender/reference_facade.py` | Replay the exact accepted GLB or existing generator plus the canonical reference solids; same coordinates/material parameters, editable hierarchy, mesh-integrity check, `.blend`, `.glb`, PNG and manifest. No vision or independent placement in Python. |
| `scripts/test-reference-*.mjs`, `scripts/fixtures/reference-facade.mjs` | Focused geometry, API/provider, image, state and project tests. Fixtures are authored tests, never AI fallbacks. |
| `scripts/check-reference-export.mjs` | Real server/Blender export check followed by Three.js GLTFLoader parsing and world-space dimension/ID checks. |

### Existing files extended

- `src/components/BlenderVillaPanel.tsx`: reuse the shared canvas; show only the accepted compatible reference overlay/materials; label old source images separately. No architecture-generation effect depends on reference edits.
- `src/lib/three/MassingScene.tsx`: optional material overrides for the existing study fallback; previous callers retain their original behaviour.
- `src/routes/Massing.tsx`, `src/components/WorkspaceTabs.tsx`, `src/lib/workspacePages.ts`, `src/main.tsx`: embedded reference section, legacy-route redirect and shortcuts; no separate reference navigation tab.
- `src/state/projects.ts`: reference documents in save/load/duplicate/project switching/version snapshots and autosave. Old project records parse with a null reference. If source identity changes, the proposal is retained for review and is not applied to the new building.
- `server/index.mjs`: reference handler integrated into the current server.
- `server/providers/gemini-web.mjs`: optional abort signal and timeout on the existing multimodal analysis call; existing callers remain compatible.
- `package.json`: `test:reference` command. No dependencies were added.

## Operations and limits

**Style transfer** changes material appearance. It does not add volumes, relocate openings or replan rooms. The selected original villa remains the source; reference materials are a separate unpriced appearance proposal, not a second Finishes & Cost catalogue.

**Preserve my current plan** keeps source rooms, occupied plates, stairs, openings and levels authoritative. New details must fit the buildable envelope and source facade anchors. Blocked openings and incompatible resizes are errors; photographed masses/openings that cannot be substituted are explicitly reported rather than applied. The accepted facade is a sibling of the cached building meshes in the existing Massing viewer.

**Reference-led envelope** builds an independent exterior shell study from observed volumes, signed parent-relative offsets, real rectangular opening holes, glazing and details. Pixel aspect is preserved using the source width unless measured height is supplied; this scale is labelled estimated. Unknown depths and projection/recess offsets block delivery. Recesses subtract the host front and require a host and negative offset. Features need a connected host. Source floors/rooms are never silently replaced. The acceptance action is labelled **Accept exterior study**; it does not promote this envelope to a validated occupied house. The reconciliation step is a visible validation requirement and review in the existing planner, not an automated floor-plan solution.

**Units:** image rectangles are normalized `(u right, v down)` within the chosen crop. Architecture uses integer mm `(plan X east, plan Y south, Z up)`; Three uses metres `(X, Z, -Y)`, Blender metres `(X, Y, Z)`. The selected side defines an explicit facade basis. Canonical plan sides are not a survey of true north or a claim that the road faces geographic south.

`REFERENCE_CONCEPT_LIMITS` exposes versioned visualization assumptions: 100 mm window clearance, 250 mm door clearance, 180 mm study shell, 5 mm minimum mesh and 600-part budget. These are conservative concept checks, not cited statutory clearances or structural engineering. New balconies also need a real source doorway in preservation mode. Existing source constraints are not relaxed to fit an image.

Images are decoded/re-encoded in the browser, limited to 8 MB/16 megapixels and supported photograph aspect ratios of 1:4 to 10:1 and resized to at most 2048 px before storage. The server independently checks magic bytes, format, dimensions and hash. Project data stores only hash/spec/settings, not embedded image bytes. Preserve `output/reference-facades/` when moving a local installation; clearing it removes reference photos/artifacts but saved geometry specifications remain.

## Setup and use

From the repository directory:

```powershell
npm install
npm run dev
```

Or build and serve the production bundle using the existing server:

```powershell
npm run build
npm start
```

Open **2D plan → Reference facade** (`/workspace/plan#reference-facade`) after generating/opening a valid house. Upload a photo, crop the facade, select the operation/mode and facade side, and enter measured dimensions if available. Analyze using a configured provider, or choose a component and draw its rectangle/enter it numerically. In reference-led mode mark a volume before its openings/features. Depth and signed offsets remain unknown until supplied or explicitly estimated.

Select components in the image, component list or 3D view. Adjust location, scale, depth, repetitions, host and material. Review validation. Use original comparison, undo/redo and reset before accepting. Adjust the camera before comparing pixels; rerun comparison after edits. Refinement proposals include parameter changes and scores, can be previewed before applying, and retain only a valid strict improvement against the unchanged observation target.

Accept a checked facade/study and save the project. Build a preview or final export; download Blender, GLB, PNG and the qualifications/semantic manifest. Old exports are labelled when settings change. Original building-only downloads and source images remain distinct from reference exports.

### Vision configuration (server only)

The default uses the existing local Gemini bridge:

```dotenv
REFERENCE_VISION_PROVIDER=gemini-web
GEMINI_WEB_URL=http://127.0.0.1:4981
# GEMINI_WEB_MODEL=<an available multimodal model>
```

For a compatible multimodal chat endpoint:

```dotenv
REFERENCE_VISION_PROVIDER=openai-compatible
REFERENCE_VISION_URL=https://your-provider.example/v1/
REFERENCE_VISION_MODEL=<your available vision model>
REFERENCE_VISION_API_KEY=<server-only credential when required>
REFERENCE_VISION_TIMEOUT_MS=45000
```

The URL is an API base ending in `/v1/`; the server calls `chat/completions`. HTTPS is required except on localhost; embedded URL credentials are rejected. Images go to the configured provider only when **Analyze facade** is chosen. Availability for a custom endpoint means configured, not a successfully tested inference. `REFERENCE_VISION_PROVIDER=disabled` keeps the complete manual workflow available. No new model checkpoint, Python ML package or GPU inference dependency is required.

Blender discovery, `BLENDER_BIN`, `VILLA_CYCLES_DEVICE` and the existing CPU/GPU fallback remain those of the current Blender pipeline. Preview uses Eevee; final uses Cycles. A single reference worker runs with at most six queued jobs. Cancel stops active analysis/Blender work; failed/cancelled jobs can be retried. Only completed verified artifacts enter the persistent cache, keyed separately from the accepted building by source, spec, settings, provider/model, code revision, quality and accepted-source content where applicable.

## API

- `GET /api/reference/health`
- `POST /api/reference/images` → `{imageBase64,mimeType}`
- `GET /api/reference/images/:sha256`
- `POST /api/reference/jobs` → `kind: analysis | reconstruct | refine | export`
- `GET /api/reference/jobs/:sha256`
- `POST /api/reference/jobs/:sha256/cancel`
- `GET /api/reference/jobs/:sha256/files/facade.blend|glb|png|json`

Reconstruct is also the validated update/result endpoint. Pixel comparison runs on the actual live renderer in the browser; refinement runs the deterministic geometry/projection pipeline on the server. Jobs expose actual stages, no invented percentage. Source requests are validated again server-side. Accepted GLB references must belong to that source plan and resolve to the server's accepted-villa records; clients cannot supply filesystem paths or scripts.

## Verification performed

- `npm run test:reference`: **26 passed**, including schema/legacy migration, all facade sides and coordinate conversions, deterministic solids, source immutability, real opening obstruction, setbacks, component collisions, unknown depths, projection/recess relationships, disconnected wings, pixel metrics, bounded refinement, image persistence, invalid provider results, timeout/cancellation, unsafe source paths, independent finish/architecture identity and project/reference save/restore/undo.
- Production TypeScript + Vite build: passed. Final check log: `output/reference-build.log`.
- `npm run lint`: exits successfully with existing repository warnings; the new reference source is checked separately without warnings. No warning was represented as a clean zero-warning repository run.
- Main regression suite: **429 passed, 7 failed (436 total)**. Failures: building-shape replay, composition replay, existing drawing-test alias resolution, stale modern-seed geometry hashes, project-history architectural replay, feasible-direction search, and distinct direction-plan replay. The six non-drawing failures were reproduced with the pre-change `projects.ts` module, without importing reference state; the drawing failure is the unchanged Vite test's unresolved `@/lib/i18n/index.ts` alias. Evidence: `output/reference-regression-tests.log`, `output/reference-baseline-failures.log`, `output/reference-baseline-drawing.log`. These are not claimed fixed by this feature.
- Actual source-villa export and independent reference-led study export completed through Blender. Three.js GLTFLoader loaded **4** added parts in the preserved-villa export and **20** in the study; world dimensions/centres, semantic IDs, manifests and artifact sizes matched canonical input. Image decoding is skipped only in the headless geometry check; rendered PNGs and live browser materials were inspected separately.
- Browser verification used an explicitly synthetic authored facade fixture: image upload, manual frame construction, source/proposal preview, actual pixel metrics and no-improvement refinement response. The final browser pass also verified aligned offscreen comparison, reload persistence, acceptance in the existing Massing viewer on seed 2932, returning to the original and undoable removal of the test proposal. Live AI inference was **not** verified because the configured Gemini bridge was offline. It correctly showed manual mode and disabled automatic analysis.

To repeat the real export check with an existing local accepted villa request:

```powershell
node --experimental-strip-types scripts/check-reference-export.mjs <request.json> /api/villas/<job-id>/files/<accepted-file>.glb
node --experimental-strip-types scripts/check-reference-export.mjs <request.json> --study
```

Evidence artifacts live in `outputs/reference-validation/` and `outputs/reference-validation-study/`. These are numerical/manual test observations, not successful AI reconstructions of a real photograph.

## Remaining limitations and next improvement

- Real multimodal inference needs a running, suitable provider. The adapter validates responses but has no claimed detection accuracy benchmark.
- A single image cannot establish rear elevations, true depth, structure, accessibility or an occupied floor plan. Hidden shell geometry is explicitly inferred. Arbitrary rotations, non-rectilinear sculptural forms, roof topology and detailed structural reconciliation are not solved.
- Opening/setback/anchor/AABB checks are concept checks against the BuildingModel. They do not prove collision freedom against every ornamental triangle of an imported GLB or structural feasibility of cantilevers.
- Refinement optimizes confidence-weighted projected component boxes using bounded candidates and rasterized geometry, not learned photometric reconstruction. The silhouette helper rasterizes real solids; no automatic photo silhouette segmentation or learned perceptual score is claimed. Pixel edge/SSIM-style scores are alignment/background/light sensitive.
- New facade additions are not added to BOQ, construction reports or walkthrough collision geometry. They are separate, explicitly unpriced concept geometry. Mode B does not replace the current occupied house.
- The new editor's copy is English. Existing application language selection remains intact.
- The existing source-plan replay regression means some old unpinned/versioned houses can rebuild differently; the reference source-ID guard retains the proposal and prevents applying it to that different house. This needs a separate planner replay repair.

The most valuable next improvement is calibrated vanishing-point/camera estimation plus a reviewed foreground facade mask from real reference photos. This would improve alignment before more complex geometry optimization; it should be evaluated on a consented, labelled image set before accuracy claims.
