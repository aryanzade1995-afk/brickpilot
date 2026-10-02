# Villa precedents

The `modern-villas-v1` reference set (20 photographs of 10 houses, Wikimedia
Commons, each under its own CC BY / CC BY-SA licence — see that set's
`LICENSES.md`) was studied for recurring architectural elements. The photos
are **not** bundled with the app and nothing is copied from them: each element
became a rule-based feature type or composition family that the generator
places on a validated plan, exactly like the existing ones. If the photos are
ever shown in the app, their attribution lines must be shown with them.

## Feature types

| Type | What it is | Precedent |
| --- | --- | --- |
| `COLONNADE` | square stone piers along a ground-floor wall carrying a loggia roof; may line a courtyard (at most 40% of its width) | Can Lis |
| `FREEFORM_CANOPY` | a thin roof slab on two slim posts, over the glazing or the entrance | Casa das Canoas, Villa Mairea porte-cochère |
| `STEEL_GRID` | black steel mullions and transoms over a wall | Eames House |
| `TIMBER_BATTEN` | horizontal timber battens across a wall | Villa Mairea, Maison Louis Carré |
| `STONE_PLINTH` | a dark stone base kept below window sills | Villa Mairea, Villa Tugendhat |

Every pier, post and slab is checked like any other feature: inside the
setback envelope, clear of structural columns (roofs start 170 mm off the
wall centreline), never in front of a door or window, and roofs above every
opening head. Blender builds them with the existing frame / fin recipes
(`blender/facade/features.py`).

## Composition families

| Style | Family | Hero → supports | Precedent |
| --- | --- | --- | --- |
| Modern box | `GLASS_PAVILION` | free canopy / deep overhang → stone plinth, louvres | Farnsworth, Stahl |
| Modern box | `STEEL_FRAME_GRID` | steel grid → projected box, overhang | Eames |
| Modern box | `RAISED_BAR` | floating box / frame → stone plinth, overhang | Kogelhof, Tugendhat |
| Contemporary | `STEPPED_WHITE` | timber battens / recessed box → overhang, plinth | Maison Louis Carré |
| Contemporary | `FREE_CANOPY` | free canopy → fins, timber spine | Casa das Canoas |
| Courtyard | `STONE_COLONNADE` | colonnade → stone plinth, pergola | Can Lis |
| Courtyard | `TIMBER_PORTICO` | free canopy / entry portal → timber battens, plinth | Villa Mairea |

A style's signature families are chosen three times as often as its others,
and a family that cannot fit the plan falls back inside the same style first.

## Plan shapes by style

- **Courtyard** — always a courtyard plan (or an L-shaped wing) when the plot
  takes one; the Directions page explores only these shapes.
- **Contemporary** — stepped, L-shaped or courtyard plans before a plain bar.
- **Modern box** — unchanged: bar and stepped plates.
