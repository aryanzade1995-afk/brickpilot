# Formstead Facade Seed Assets

This branch is separate from `main`. All files live under `formstead_facades/` and **do not change the product source code**.

## Assets
- 10 reproducible modern house facade seeds
- 10 architectural styles, with non-cubic asymmetric massing
- 10 consistent camera views per design (100 JPEGs)
- 10 corresponding 3D GLB models
- Generator source and per-seed prompts

The generated 3D concept models and camera renders are **schematic**, not photorealistic engineering drawings.

## Download to Windows PC
In your existing project checkout:

```powershell
git fetch origin assets/formstead-facades-100-views
git switch --track origin/assets/formstead-facades-100-views
```

If this is a new clone, use the GitHub **Code** button and select this branch before downloading.

## Reproducibility
Each numeric seed is deterministic in the procedural generator; these are geometry seeds, **not diffusion-image model seeds**. Use the same underlying GLB to render multiple views. Validate structural grid, openings and setbacks against the actual 2D plan before applying any facade to a real project.

## Seeds
| Design | Seed | Style |
| --- | ---: | --- |
| D01 | 11021 | Cantilever Ribbon |
| D02 | 22034 | Glass Bridge |
| D03 | 33047 | Horizon House |
| D04 | 44052 | Curved Corner |
| D05 | 55063 | Terrace Garden |
| D06 | 66078 | Split Pavilion |
| D07 | 77085 | Diagonal Blade |
| D08 | 88092 | Stone Tower |
| D09 | 99103 | Floating Carport |
| D10 | 10117 | Perforated Screen |
