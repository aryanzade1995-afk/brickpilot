# BrickPilot — project summary

**AI house feasibility studio.** A guided brief about a residential plot becomes a
dimensionally-accurate plan set, a 3-D model, a validation report and a build-cost
band. Pure client-side React with a thin Node proxy; no architect in the loop —
everything is deterministic and seeded, so the same brief plus the same seed always
gives the same house.

- **Repo:** `aryanzade1995-afk/brickpilot`
- **Branch:** `feat/real-topology-plus-grammar` — 16 commits ahead of `main`, **not merged**
- **Stack:** Vite · React 19 · TypeScript · Tailwind v4 · Zod · three.js / react-three-fiber · zustand
- **Backend:** `server/index.mjs`, a zero-dependency Node proxy (Gemini image renders + the GLB lookup). Deploy target is Render's free plan, which is why Blender can never be a live service.

See [`README.md`](README.md) for the stack and deploy steps, [`blender/README.md`](blender/README.md)
for the geometry engine, and [`brickpilot-architecture-dataset/README.md`](brickpilot-architecture-dataset/README.md)
for the reference dataset.

## The pipeline

```
Brief (8-step wizard)
  -> CanonicalModel        rooms, zones, target areas, relationships
  -> Engine  Design        footprint shape -> hub layout -> walls / doors / windows -> reachability
  -> Architecture DesignSpec   style grammar -> design genome -> massing -> structure -> facade -> audit
  -> Blender               procedural geometry -> GLB   (offline bake, not a live service)
  -> Viewer                the GLB when one is baked, else procedural buildMassing / buildDollhouse
```

Each stage owns one decision and hands the next a finished artefact. The floor plan
is the source of truth: doors belong to a room and a wall, windows are chosen from
the room outward (room -> exterior wall -> orientation -> type -> style), and the
facade is resolved **last**, anchored to real elements rather than world coordinates.

## Layers

| Area | Lines | What it does |
|---|---:|---|
| `src/lib/model/` | 789 | Zod brief + `compile()` -> canonical rooms, relationships, areas |
| `src/lib/engine/` | 1,466 | **The plan.** ResPlan-grounded: the living room is the circulation hub, there is no corridor, every room opens onto it |
| `src/architecture/` | 1,824 | `generateDesign(req, seed) -> DesignSpec` + a 4-attempt audit rejection loop |
| `src/architecture/library/` | 2,969 | Vocabulary, compatibility rules, style patterns, **design genome**, architectural fingerprint |
| `src/architecture/generator/` | 2,087 | Massing, structure (grid / columns / beams / slabs), windows, balconies, facade, **architecturalValidator** |
| `src/lib/three/` | 3,493 | `buildMassing` (study model), `buildDollhouse` (furnished cutaway), GLB loader |
| `src/lib/rules/` | 358 | Zoning, coverage, setback and room-area validation -> feasibility score |
| `blender/generator/` | 1,283 | 17 Python modules — runs *without* `bpy` as a CI spec-validator |
| `src/routes/` | 2,218 | Brief -> Directions -> 2D Plan -> 3D Massing -> Render -> Report |
| `scripts/` | 2,987 | 13 test suites plus dataset tooling and the ResPlan miners |

## Grounded in real data, not vibes

- **ResPlan** — 17k real South-Asian floor plans (arXiv 2508.14006, CC BY 4.0). Mined
  for the layout grammar: `front_door -> living` in 2997/3000 plans, living at
  normalised centroid (0.50, 0.59) taking ~34 % of floor area, bedrooms wrapping the
  perimeter each with an adjacent bath, kitchen in a back corner. Also door jamb
  offsets (~100 mm off the nearest corner) and window centring.
- **NBC 2016** — stair geometry (tread 275 / riser 175 / landing after 12 risers /
  headroom 2100), the 10 % light-and-vent ratio, habitable room minimums.
- **RCC residential practice** — economical bay spacing 3.0–4.5 m, column sections
  230 / 300 / 300 / 380 mm for G+0..G+3.

Every dimension lives in one file, `src/architecture/dims.ts`. No magic numbers, and
the whole pipeline is millimetres.

## The two ideas that make designs differ

**Design Genome** (`src/architecture/library/designGenome.ts`) — a seeded,
compatibility-filtered set of architectural decisions (massing composition, upper-floor
strategy, roof, entrance, balcony, facade composition, screen, glazing, courtyard,
storey offset, cantilever). It sits between the style grammar and the DesignSpec, so
"a different design" means a different *composition*, not a recolour.

**Architectural Fingerprint** (`fingerprint.ts`) — a 7-axis canonical signature
(massing / floors / roof / entrance / balcony / facade / courtyard) plus a 12-char
hash, with a weighted similarity metric. Two designs scoring >= 0.86 are "the same
design". This is what the diversity test measures against, and it has a Python mirror
so the offline dataset and the runtime agree.

## Structural honesty

`resolveStructure()` builds a real frame — a bay grid snapped to partition walls,
columns at grid intersections (corners always; perimeter mid-columns only where a bay
exceeds 6 m *and* lands on a partition; interior columns only for >6 m double spans),
beams, and slabs per block per level. Upper columns must align within 50 mm or get a
transfer beam that straddles two columns below.

`auditArchitecture()` then scores the result 0–100 and returns typed errors, warnings
and repairs. Major errors trigger regeneration with a new seed, best score kept.
The design goal: **the model still makes architectural sense with every material,
colour and decorative element stripped away.**

## Current shipping surface

- **2 styles** — Modern Indian, Contemporary Indian. Both flat-roofed. The six
  pitched / courtyard styles were retired because their geometry cannot be verified
  without a Blender bake; saved briefs using them migrate automatically.
- **2 of 6 footprint shapes** — `rectangle`, `square`. `l-shape` / `t-shape` /
  `u-shape` / `courtyard` are **Milestone B, not built**; `pickShape` falls back to
  rectangle, which is why the genome's `courtyard` axis is permanently `none`.
- **G+0 through G+3**, 1–5 bedrooms, villa or large-villa typology.
- **Dataset** — 520 synthetic design genomes (286 modern / 234 contemporary),
  0 duplicates, 0 unknown licences, quality score **100/100**.

## Verification

Thirteen test scripts, run with `npx tsx scripts/<name>.mts`. All green.

| Script | Asserts |
|---|---|
| `enginetest` | one full brief end to end; determinism |
| `matrix` | every shape x storey count validates and stays reachable |
| `roomtest` | room dimensions, adjacency, no sliver geometry |
| `layouttest` | the hub topology holds across shapes / bedrooms / characters |
| `doortest` | **one circulation door per room**, no doorless room |
| `typologytest` | large-villa programme scales correctly |
| `bighousetest` | big plots x every massing x G+1..G+3, plan *and* 3-D geometry |
| `gramtest` | the style grammar produces valid specs |
| `masstest` / `vdbg` | 3-D box geometry — no degenerate, oversized or off-plot boxes |
| `villatest` | the acceptance test: same requirements, 5 seeds, visibly different |
| `structuretest` | frame integrity — no floating columns / slabs, NBC stairs, anchored facade |
| `diversitytest` | 50 seeds, identical requirements, architecturally distinct |
| `dirtest` | the Directions step offers genuinely different schemes |

Headline numbers:

- structural audit averages **95/100 with 0 errors** over 30 cases
- 50-seed diversity test: **47–50 of 50** substantially distinct, mean similarity < 0.5
- one-door-per-room holds at **99.84 %** across 4,177 rooms
- **60/60** Blender dry-run specs validate
- `tsc` and `oxlint` clean, `vite build` ~1.5 s

## Known gaps

1. **Blender has never actually run.** No machine with it installed in any session so
   far. All validation is `py_compile` plus the no-`bpy` spec-validator path. The first
   real bake needs Blender 4.x and `node blender/bake/bake.mjs`, then tuning the `.py`
   geometry against reference photos.
2. **Milestone A review is still owed.** The living room / family lounge runs generous
   (48–58 m² on the tiny default plot). Warnings, not errors — but it was never signed
   off before the project pivoted to the architectural grammar.
3. **Milestone B shapes.** L / T / U / courtyard footprints are unbuilt. Until they
   exist a chunk of the design vocabulary is unreachable.
4. **`room-no-window` warnings** (~1.4 per spec) are engine-landlocked interior rooms.
   The regeneration loop cannot fix these — it re-rolls the genome, not the plan.
   Fixing them means work in `src/lib/engine/layout/`.
5. **No real reference photos.** Open-licensed sources carry essentially no
   contemporary Indian residential architecture: a 90-query harvest returned 86
   licence-clean images, almost all public-domain book scans, of which ~2 survived
   dedup. The synthetic genomes *are* the dataset. A real corpus needs owned
   photographs plus `GEMINI_API_KEY`, or a licensed dataset.
6. **`src/lib/engine/massing/`** — the retired 15-archetype grammar is still on disk
   and unused. Safe to delete.

## Next

- Merge `feat/real-topology-plus-grammar` into `main` once Milestone A is signed off
  and a first bake exists.
- A CI action that bakes on changes to `src/architecture/` or `blender/`, uploads the
  GLBs to R2 or Supabase Storage and commits `manifest.json`. The same job can run
  `sync-vocabulary`, `genome-corpus` and `validate_dataset`.
