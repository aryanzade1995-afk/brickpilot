# Pipelines and underground tanks

Finishes & Cost → Plumbing & sanitary exposes supply/drain materials, four pipe
size controls, an underground RCC clean-water tank and a separate drain option.
The drain options are an inspection chamber, septic tank or sealed holding tank.
The clean-water and wastewater tanks are never the same object or cost line.

The schedule uses source wet-room point counts and storey heights: 8 m per point
for water branches, 6 m per point split 60/40 between waste and soil, plus risers.
These are explicit planning allowances, not measured or clash-checked routes.
Water sizes are nominal reference sizes; SWR waste and soil sizes are outside
diameters. Confirm the selected manufacturer's pipe series, pressure/SDR class,
fixture demand, vents and gravity gradients in the detailed plumbing design.

Tank storage defaults retain the existing occupant-based clean-water allowance.
Manual underground capacities are 3,000 / 5,000 / 10,000 / 15,000 L, or off.
Tank dimensions describe usable internal storage at 1.5 m water depth; shell
thickness, freeboard, access and safe siting require a separate site design.
Septic choices do not establish a compliant soil-absorption/disposal system.

Each pipe line has a material, size, floor, length, installed rate, material cost
and labour cost. Size factors scale the existing provisional per-metre rates.
New tank and pipe rates are tagged as concept plumbing allowances, not verified
supplier quotes or published PWD prices. Overhead tanks now price overhead
capacity only; underground storage is a separate cubic-metre line, avoiding
the old combined overhead/underground charge. Drain chambers price one item;
septic/holding storage prices cubic metres. Normal excavation, covers and the
tank shell are allowances; pumps, difficult ground and disposal fields are not.

The 3D cutaway is a system schematic with selected tank proportions and pipe
sizes, not an installed site layout. Service choices persist in `specs.overrides`,
flow into quantities, BOQ, CSV/Excel and specification exports, and do not affect
the building seed, plan identity or whole-villa render signature.

Primary pipe-size references consulted:
- [Astral CPVC Pro catalogue](https://astralpipes.com/wp-content/uploads/2022/12/CPVC-Pro_PC_MAY-2024.pdf)
- [Ashirvad SWR drainage catalogue](https://ashirvad.com/wp-content/uploads/2021/04/Ashirvad-SWR.pdf)

Validation: `npm run test:plumbing` plus the existing quantities, BOQ,
specification data, saved-brief and Blender navigation suites.
