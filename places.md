# Architectural 2D & 3D Model Visualization Map: BrickPilot (Formstead)

This document provides a comprehensive inventory of every location in the **BrickPilot (Formstead)** residential architecture studio where **2D architectural drawings** and **3D spatial models** are generated, manipulated, and displayed to the user.

---

## Summary Table: Visual Models Across Application Routes

| Route | View Kind | Primary Component | Engine / Technology | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`/workspace`** | 2D Feedback | [`FitNotice.tsx`](src/routes/brief/FitNotice.tsx) / [`FitMeter.tsx`](src/routes/brief/FitMeter.tsx) | SVG / TypeScript Geometry | Real-time 2D buildable envelope & room area capacity indicator. |
| **`/workspace`** (Step 05) | 2D / 3D Room | [`FurniturePreview.tsx`](src/routes/brief/FurniturePreview.tsx) | SVG + Three.js (`@react-three/fiber`) | 2D schematic floor plan & 3D furniture layout inspector per room type. |
| **`/workspace/directions`** | 2D Plan | [`FloorDrawing.tsx`](src/lib/draw/FloorDrawing.tsx) | SVG vector linework | Multi-floor CAD thumbnail previews on each of the 4 direction cards. |
| **`/workspace/directions`** | 3D Render | [`Directions.tsx`](src/routes/Directions.tsx) | Headless Blender (Cycles / EEVEE) | Distinct 3D perspective hero renders generated per candidate direction. |
| **`/workspace/plan`** | 2D CAD Sheet | [`DrawingWorkspace.tsx`](src/components/DrawingWorkspace.tsx) | SVG vector linework | Primary multi-layer architectural CAD drawing sheet with CAD dark / Paper light themes. |
| **`/workspace/plan`** | 2D Editor | [`PlanEditor.tsx`](src/components/PlanEditor.tsx) | Interactive SVG canvas | Interactive room-by-room CAD editor with live boundary and constraint snapping. |
| **`/workspace/plan`** | 2D Safety | [`safety.ts`](src/lib/engine/safety.ts) via `Plan.tsx` | SVG linework | 2D emergency escape egress layout and travel distance calculations. |
| **`/workspace/massing`** | 3D Building | [`BlenderVillaPanel.tsx`](src/components/BlenderVillaPanel.tsx) | Three.js + Blender `.glb` | Interactive 3D WebGL viewer of the fully materialized villa and plot landscape. |
| **`/workspace/massing`** | 3D Procedural | [`MassingScene.tsx`](src/lib/three/MassingScene.tsx) | Three.js (`buildMassing.ts`) | Procedural 3D solid massing model generated directly from 2D footprint blocks. |
| **`/workspace/massing`** | 3D Dollhouse | [`DollhouseScene.tsx`](src/lib/three/DollhouseScene.tsx) | Three.js (`buildDollhouse.ts`) | Interactive 3D furnished cutaway dollhouse with floor levels and dressed rooms. |
| **`/workspace/interior`** | 3D Panorama | `Panorama` in [`FastInteriorPreview.tsx`](src/components/FastInteriorPreview.tsx) | Three.js Equirectangular Sphere | 360° interactive spherical interior walkthrough rendered via Blender EEVEE. |
| **`/workspace/interior`** | 2D Room Plan | [`RoomPlan2D.tsx`](src/components/RoomPlan2D.tsx) | Pure Architectural SVG | Scaled 2D room floor plan with furniture, dimensions, and live 60 FPS viewpoint tracking. |
| **`/workspace/interior`** | 2D Blueprint | `RoomPlan2D` Modal Dialog | Architectural Blueprint SVG | High-definition 2D room layout inspection modal with dimension ticks. |
| **`/workspace/finishes`** | 3D PBR Material | [`FinishObjectPreview.tsx`](src/routes/finishes/FinishObjectPreview.tsx) | Three.js PBR Shaders | Real-time 3D object and surface preview for ceilings, tiles, plinths, and lighting. |
| **`/workspace/finishes`** | 3D MEP Piping | [`PlumbingPreview.tsx`](src/routes/finishes/PlumbingPreview.tsx) | Three.js 3D Mesh | 3D spatial layout viewer for plumbing shafts, drainage stacks, and water lines. |
| **`/workspace/existing`** | 2D As-Built | [`PlanView.tsx`](src/components/existing/PlanView.tsx) | SVG CAD overlay | 2D architectural drawing showing locked existing columns, beams, walls, and conflicts. |
| **`/workspace/existing`** | 2D Calibration | [`PhotoEditor.tsx`](src/components/existing/PhotoEditor.tsx) | HTML5 Canvas / SVG | Interactive 2D coordinate picker and calibration tool for scanned floor-plan sketches. |
| **`/workspace/report`** | 2D Report Sheets | [`FloorDrawing.tsx`](src/lib/draw/FloorDrawing.tsx) / [`buildPdf.ts`](src/lib/report/buildPdf.ts) | SVG rasterized to PDF | Vector floor and terrace plans rendered at print-ready A4/A3 resolution. |
| **`/workspace/report`** | 3D PDF Captures | [`CaptureCanvas.tsx`](src/lib/render/CaptureCanvas.tsx) | Headless Three.js WebGL | Offscreen WebGL viewport rendering 4 orthographic/isometric building snapshots for the PDF. |
| **`/workspace/solar`** | 2D / 3D PV Layout | [`roofModel.ts`](src/lib/solar/roofModel.ts) / [`solar_replay.py`](blender/solar_replay.py) | SVG + Blender 3D | 2D terrace polygon solar array layouts & 3D roof panel placement with shadow analysis. |

---

## Detailed Architectural Breakdown

### 1. 2D Architectural Drawings & Vector Interfaces

#### A. Main Architectural Drawing Sheet (`/workspace/plan`)
* **Component**: [`src/components/DrawingWorkspace.tsx`](src/components/DrawingWorkspace.tsx)
* **Underlying Renderer**: [`src/lib/draw/FloorDrawing.tsx`](src/lib/draw/FloorDrawing.tsx)
* **Coordinate Space**: Integer millimeters ($1\text{ unit} = 1\text{ mm}$), converted to responsive SVG viewports.
* **Layers & Visual Presets**:
  * **Presentation**: Colored room zone fills, furniture layouts, site boundaries, and landscaping.
  * **Architectural**: High-contrast wall cuts, door swing arcs, window sill details, room names, and dimension strings.
  * **Validation**: Highlights room reachability graphs, emergency egress distances, and minimum natural daylight apertures.
  * **Structural / Supports**: Displays structural column grids, plinth beams, and load-bearing walls.
* **Themes**:
  * `CAD dark` (`#11161c` background with crisp architectural neon linework).
  * `Paper light` (`#ffffff` background simulating printed blueprint sheets).
* **Controls**: Per-floor switching (Ground, Floor 1, Floor 2, Terrace), zoom slider ($50\%$ to $300\%$), fit-to-view, SVG export, and vector PDF print.

#### B. Interactive 2D CAD Plan Editor (`/workspace/plan?edit=1`)
* **Component**: [`src/components/PlanEditor.tsx`](src/components/PlanEditor.tsx)
* **Functionality**:
  * Allows interactive floor plan manipulation while guaranteeing compliance with architectural rules.
  * Drag-and-drop room repositioning with live wall intersection checks.
  * Interactive resize handles on all 4 boundaries ($N, S, E, W$).
  * Real-time constraint snapping to column grids and buildable setback margins.
  * Multi-level room swap tool (e.g. moving a bedroom from Ground to Floor 1).
  * Undo / Redo history management with state serialization ([`src/state/planEdit.ts`](src/state/planEdit.ts)).

#### C. Room Mini-Map & Human Viewpoint Tracker (`/workspace/interior`)
* **Component**: [`src/components/RoomPlan2D.tsx`](src/components/RoomPlan2D.tsx)
* **Parent View**: [`src/components/FastInteriorPreview.tsx`](src/components/FastInteriorPreview.tsx)
* **Functionality**:
  * Pure SVG top-view floor plan generated specifically for the active room being previewed.
  * Wall segment lines automatically skipping door and window openings.
  * Accurate architectural door swing arcs ($90^\circ$ quadrant arcs) and window sill double lines.
  * Scaled furniture placement (beds with duvets/pillows, dining tables, chairs, sofas with armrests, wardrobes, kitchen counters, sinks).
  * **Live Viewpoint Tracking (60 FPS)**:
    * Human standing dot marker (`●`).
    * $65^\circ$ field-of-vision cone rotating dynamically with camera azimuth angle ($\text{yaw}$).
    * Sight pointer needle indicating line of sight.
  * **Two UI Display Positions**:
    1. *Header Mini-Map*: Positioned in top-right whitespace in standard mode.
    2. *Full-Screen HUD*: Floating semi-transparent glassmorphic panel pinned to the top-right corner when in full-screen exploration.
  * **Expand Blueprint Modal**: Opens an expanded architectural blueprint dialog with dimension ticks.

#### D. As-Built & Renovation Plan View (`/workspace/existing`)
* **Component**: [`src/components/existing/PlanView.tsx`](src/components/existing/PlanView.tsx)
* **Functionality**:
  * Displays surveyed building footprints, existing column coordinates, and locked load-bearing walls.
  * Visual status coding:
    * **Existing & Locked** (`#141414` black): Surveyed structures that cannot be moved.
    * **Proposed Elements** (`#1D4E89` blue): Newly generated rooms and walls.
    * **Conflicts** (`#C62828` red): Overlaps between newly requested spaces and immovable existing columns/walls.
* **Coordinate Calibration**: [`PhotoEditor.tsx`](src/components/existing/PhotoEditor.tsx) allows users to calibrate scale and origin offsets on scanned drawings.

---

### 2. 3D Spatial Models & WebGL Viewports

#### A. Interactive Blender Villa GLB Viewer (`/workspace/massing`)
* **Component**: [`src/components/BlenderVillaPanel.tsx`](src/components/BlenderVillaPanel.tsx)
* **Renderer**: Three.js / React Three Fiber ([`@react-three/fiber`](https://github.com/pmndrs/react-three-fiber)).
* **Asset Pipeline**:
  * Headless Blender 4.5 Python script ([`blender/generator.py`](blender/generator.py)) compiles the verified 2D plan into 3D meshes.
  * Exports a binary `.glb` scene loaded client-side via `@react-three/drei`.
* **Visual Elements**:
  * PBR exterior finishes (stone cladding, fluted panels, timber battens, glass balustrades).
  * Terrain features: Plot grade, recessed swimming pool with water basin, driveway paving, pathways, and lawns.
  * Camera presets: Front, Rear, Left, Right, Isometric, and Top orthographic views.
  * Dynamic sun positioning, directional shadows, and OptiX-denoised ambient occlusion.

#### B. Furnished 3D Cutaway Dollhouse (`/workspace/massing`)
* **Component**: [`src/lib/three/DollhouseScene.tsx`](src/lib/three/DollhouseScene.tsx)
* **Geometry Engine**: [`src/lib/three/buildDollhouse.ts`](src/lib/three/buildDollhouse.ts) & [`src/lib/three/dressRoom.ts`](src/lib/three/dressRoom.ts)
* **Functionality**:
  * Creates an open-top architectural dollhouse cutaway model.
  * Floor isolate selector (`All`, `Ground`, `Floor 1`, `Floor 2`).
  * Procedurally furnishes each room based on room type, area, and furniture density presets.
  * Applies selected material finishes (e.g. beige marble, dark wood, travertine) directly to floor slabs and walls.
  * Real-time post-processing effects: N8AO (ambient occlusion), SMAA anti-aliasing, and soft vignette.

#### C. Procedural Three.js Building Massing (`/workspace/massing`)
* **Component**: [`src/lib/three/MassingScene.tsx`](src/lib/three/MassingScene.tsx)
* **Geometry Engine**: [`src/lib/three/buildMassing.ts`](src/lib/three/buildMassing.ts)
* **Functionality**:
  * Lightweight client-side 3D modeler that operates without calling Blender.
  * Extrudes 2D footprint blocks into 3D building masses, hollows out courtyards, punches door and window openings, and builds roof parapets and pitched prisms.

#### D. 360° Spherical Panoramic Interior Walkthrough (`/workspace/interior`)
* **Component**: [`src/components/FastInteriorPreview.tsx`](src/components/FastInteriorPreview.tsx)
* **Renderer**: Three.js WebGL inverted sphere (`radius: 10`, `segments: [64, 32]`) mapped with an equirectangular WebP texture.
* **Features**:
  * Equirectangular panorama rendered by Blender EEVEE in Fast ($2048 \times 1024$) or High ($4096 \times 2048$) resolution.
  * Orbit controls allowing continuous $360^\circ \times 180^\circ$ free look.
  * Dynamic field of view ($35^\circ$ to $100^\circ$) with mouse wheel and two-finger pinch zoom.
  * Real-time azimuth yaw extraction feeding the 2D room mini-map.

#### E. 3D Finish & Material Inspector (`/workspace/finishes`)
* **Component**: [`src/routes/finishes/FinishObjectPreview.tsx`](src/routes/finishes/FinishObjectPreview.tsx)
* **Functionality**:
  * Interactive 3D object and material viewer for 19 finish groups.
  * Renders PBR textured spheres, ceiling slabs, roofing profiles, and plumbing fixtures with physically accurate roughness and metallic reflections.

#### F. 3D MEP Plumbing & Riser Viewer (`/workspace/finishes`)
* **Component**: [`src/routes/finishes/PlumbingPreview.tsx`](src/routes/finishes/PlumbingPreview.tsx)
* **Functionality**:
  * 3D spatial schematic displaying wet areas across all storeys (kitchens, attached baths, powder rooms, utilities).
  * Visualizes vertical drainage stacks, plumbing shafts, and terrace water tanks to inspect sanitary alignment.

#### G. Offscreen 3D Capture Viewport for PDF Reports (`/workspace/report`)
* **Component**: [`src/lib/render/CaptureCanvas.tsx`](src/lib/render/CaptureCanvas.tsx) (`MassingViewport`)
* **Functionality**:
  * Dedicated offscreen WebGL canvas used during report generation.
  * Automatically rotates to 4 fixed camera perspectives (`front`, `rear`, `iso`, `top`), captures canvas frame buffers, and embeds high-resolution 3D renders into client PDF reports.

---

## Technical File Locations

```
src/
├── components/
│   ├── BlenderVillaPanel.tsx       # 3D Blender GLB viewer with camera presets & site terrain
│   ├── DrawingWorkspace.tsx        # 2D Multi-layer architectural CAD drawing sheet
│   ├── FastInteriorPreview.tsx     # 3D 360° Equirectangular interior walkthrough
│   ├── PlanEditor.tsx              # 2D Interactive room-by-room CAD plan editor
│   ├── RoomPlan2D.tsx              # 2D Scaled room floor-plan mini-map & live viewpoint HUD
│   └── existing/
│       ├── PhotoEditor.tsx         # 2D Survey photo coordinate calibration tool
│       └── PlanView.tsx            # 2D As-built structural plan & conflict visualizer
├── lib/
│   ├── draw/
│   │   ├── FloorDrawing.tsx        # Core SVG vector linework generator for 2D plans
│   │   └── layers.ts               # Layer visibility toggles (presentation, CAD, structural)
│   ├── render/
│   │   ├── CaptureCanvas.tsx       # Offscreen 3D WebGL canvas for PDF report captures
│   │   └── rasterizeSvg.ts         # High-DPI 2D SVG to canvas rasterizer
│   └── three/
│       ├── buildDollhouse.ts       # Geometry compiler for 3D furnished cutaway views
│       ├── buildMassing.ts         # Procedural 3D solid massing extruder
│       ├── DollhouseScene.tsx      # R3F scene for 3D furnished dollhouse
│       └── MassingScene.tsx        # R3F scene for procedural 3D building massing
└── routes/
    ├── Directions.tsx              # 2D floor drawing & 3D hero render cards
    ├── Massing.tsx                 # 3D Massing & Dollhouse view container
    ├── Plan.tsx                    # 2D CAD floor plan workspace
    ├── Report.tsx                  # 2D vector & 3D render PDF compiler
    └── finishes/
        ├── FinishObjectPreview.tsx # 3D PBR material and object inspector
        └── PlumbingPreview.tsx     # 3D spatial MEP plumbing layout viewer
```
