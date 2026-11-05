# Formstead — Facade Integration Instructions

Goal: apply one of ten reproducible modern, asymmetric facade styles to an already validated Formstead floor plan.

## Prompt for the 3D pipeline
Given a validated building JSON containing plot boundary, setbacks, structural grid, columns, walls, floor slabs, rooms, doors, windows, stairs, shafts, terraces and north direction, create a coherent modern 3D facade. Select a design seed from the table in README.md and use that seed's named style, but never replace the verified 2D geometry with a generic cube. Generate layered asymmetrical massing using real roof and balcony planes, articulated entry portals, vertical louvers, glass screen assemblies, cantilever frames, shading devices and optional planters. Respect the verified spatial layout, and reject any facade change that blocks required ventilation, light, access or egress. Flag cantilevers, spans and structural changes for engineer review.

Create a single coherent world-space scene; generate all views by moving a camera, not independently generating images. Return:
- one GLB scene with named geometry, meters as units
- a manifest containing design seed, geometry version, material palette, story heights and camera transforms
- ten deterministic high-resolution views: front, front-left, front-right, left, right, rear, rear-left, rear-right, elevated front, elevated rear
- a validation summary showing unchanged structural grid, openings and setbacks

Do not assume the bundled ten generic concept meshes fit an actual user's plot. Adapt the style rules to the validated plan.

## Using the assets
The 10 GLB models and 100 JPEG camera views are **outputs** of `generate_pack.py`.
To build them locally:
```powershell
py -m pip install numpy pillow trimesh
py formstead_facades/generate_pack.py
```
Outputs are written under `formstead_facades/images_100`, `glb_models_10`, and `contact_sheets_10`.

## Important
The seeds are deterministic procedural geometry seeds, not diffusion-model seeds. The geometry previews are schematic and are not engineering-grade architectural drawings.
