# BrickPilot

AI house feasibility studio — turn a guided brief about a residential plot into a
dimensionally-accurate plan set, a validation report and a build-cost band.

A free-tools rebuild. See the teardown / architecture notes for the full plan.

## Stack

| Layer | Tool |
|---|---|
| Frontend | Vite + React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Routing | react-router-dom v7 |
| Validation / schema | Zod |
| Deterministic engine | custom (seedrandom + computational geometry) |
| 3D massing *(later)* | three.js + react-three-fiber |
| AI renders *(later)* | Gemini 2.5 Flash Image / local ComfyUI |
| Advisory LLM *(later)* | Gemini free tier + pgvector |
| Accounts + saved designs | Supabase (Auth + Postgres, RLS) |
| Report export | jsPDF + jspdf-autotable (lazy-loaded) |

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

## Deploy (Render)

One web service serves the built SPA and proxies `/api/render`, so the Gemini
key never reaches the browser.

- **Blueprint:** commit `render.yaml`, then in Render → *New → Blueprint* pick this
  repo. It provisions the service with build `npm ci --include=dev && npm run build`
  and start `npm start`.
- **Manual:** *New → Web Service* → this repo → runtime **Node**, build
  `npm ci --include=dev && npm run build`, start `npm start`.
- Set **`GEMINI_API_KEY`** in the service's *Environment* tab
  ([aistudio.google.com/apikey](https://aistudio.google.com/apikey), free tier).
  Without it the render step still works — it echoes the massing reference.

Run the production bundle locally:

```bash
npm run build && npm start   # http://localhost:8787
```

## Accounts & saved designs (Supabase)

Optional. The app is fully usable signed-out — the Home page is the landing for
everyone and nothing is gated. Signing in only lets you **save a design to your
account** (Save in the workspace header) and reload past ones from **My designs**
(`/designs`). A saved design is just its brief + pinned direction; the
deterministic engine rebuilds the plan, validation and costs from that.

With the env below unset, the app still builds and runs — the sign-in button just
shows an "off" state.

1. Create a free project at [supabase.com](https://supabase.com).
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase **SQL editor**
   (it creates the `designs` table, its RLS policy and an `updated_at` trigger).
3. **Auth → Providers**: keep **Email** enabled. For a friction-free demo you can
   turn **"Confirm email"** off — the sign-in dialog handles both.
4. Copy `.env.example` → `.env.local` and fill in **`VITE_SUPABASE_URL`** and
   **`VITE_SUPABASE_ANON_KEY`** (Supabase → *Settings → API*). For production set
   the same two in the Render dashboard. The anon key is meant to ship in the
   browser — RLS is the security boundary.

## Project report (PDF)

Workspace step **06 · Report** shows the whole-project summary and exports it as a
single PDF (**Download PDF**): cover + brief · per-floor plan drawing + room
schedule · 3D massing views · all validation findings · the full cost estimate ·
any generated concepts. **Clear** wipes only the generated concept/interior
images — the brief, plan, findings and cost stay. jsPDF loads as a lazy chunk, so
it costs nothing until you export.

## Typology & character (Style step)

Two orthogonal choices on the Style step drive the geometry:

- **Typology** — *Villa / bungalow* or *Large villa*. A large villa inflates the
  habitable programme ~1.2–1.3×, widens the footprint (held under the concept
  coverage limit), adds a generous forecourt / courtyard when the plot allows,
  and carries a +12 % build-rate premium. `repairNarrow()` in the engine slides
  a party wall to widen any room the treemap left below the 2.4 m minimum.
- **Character** — an 8-style catalogue: *Modern Indian*, *Contemporary Indian*,
  *Modern Kerala*, *Kerala Contemporary*, *Luxury Indian villa*, *Tropical Indian
  modern*, *Minimal Indian*, *Courtyard Indian modern*. Each is a `ThemeDef`
  (`src/lib/model/themes.ts`) built from a shared `BASE` + a small delta — window
  rhythm, roof bias (flat / pitched / mixed), cladding, screens, columns,
  verandah, landscaping and the step-4 render prompt. Character controls **style
  only** — never the structure (that is `style.massing`). Legacy ids
  (`modernist` / `warm-minimal` / `kerala-contemporary`) migrate on load via
  `MIGRATE_CHARACTER`. `roofBias: 'pitched'` biases the massing grammar toward
  real hip / gable / mono-slope roofs — rendered as a `prism` primitive
  (`MassingScene.tsx` `makePrism`). `verandah` + `columns` add a colonnaded
  covered sit-out along the entry facade (square / round / tapered posts).

## Massing grammar (Style step)

Structure is chosen **before and independently of** style. `src/lib/engine/massing/`
is a seeded procedural grammar:

- **`archetypes.ts`** — one pure `(env, ctx, rng, diversity) → MassingPlan` per
  form: `rectangular`, `l-shape`, `t-shape`, `u-shape`, `courtyard`,
  `rear-courtyard`, `offset-box`, `split-volume`, `cantilever`, `stepped`,
  `interlocking`, `central-core`, `side-wing`, `front-projection`, `asymmetric`.
  A plan is a per-storey **rect-union** (1–4 axis-aligned blocks) + a courtyard
  void + the roof spec.
- **`grammar.ts`** — `planMassing()` picks an archetype (`auto` scores every form
  against plot aspect / storeys / programme fit with a seeded jitter; `random`
  shuffles; an explicit choice is honoured, falling back to `rectangular`), then
  hard-clamps every block inside the setback line, drops the stair core into the
  column every storey shares, and re-rolls on any geometry that fails
  `validateMassingPlan` (disconnected blocks, an unsupported oversail, a floor
  too small for its programme).
- **Seed + diversity** — the Style step exposes a **Massing** picker
  (Auto / the archetypes / Random), a **Design variation** control
  (Low → Extreme, scaling offset amplitude and the cantilever cap 0.9 → 3.6 m /
  0.7 → 1.75 m) and a **Seed** field. Same seed + brief ⇒ byte-identical villa;
  a new seed ⇒ a structurally different one. The Directions screen offers the
  `auto` pick plus a ladder of distinct validated alternates.

`scripts/massingtest.mts` asserts 1000 seed × archetype × character combinations
are all valid, reachable and hard-clean, and that 20 `auto` seeds spread across
several massing types with real per-floor movement. `scripts/massinggrid.mts`
renders a contact sheet.

`src/lib/engine/massing/stats.ts` holds the scale-invariant parameter ranges the
grammar reads from the dataset analysis (footprint solidity → the `auto` picker's
rect / non-rect split ≈ 1 in 5; per-floor offset ceiling ≈ 26 % of span). Every
value is clamped to a safe band; villa-specific numbers stay on the hand-tuned
defaults in `archetypes.ts`.

## Datasets

The generator's room-size / adjacency numbers are tuned against **ResPlan**
([github.com/m-agour/ResPlan](https://github.com/m-agour/ResPlan), 17k South-Asian
plans, CC BY 4.0). We only read it for *statistics* — nothing from the dataset is
shipped (it carries a takedown policy). To regenerate the numbers:

```bash
pip install numpy shapely networkx          # + ResPlan/requirements.txt
python scripts/resplan_stats.py path/to/ResPlan.zip   # → scripts/resplan_stats.json
```

then re-tune `AREA` in `src/lib/model/canonical.ts` and `MIN_DIM` in
`src/lib/rules/index.ts`. The committed `resplan_stats.json` currently holds
provisional NBC-2016 / practice reference values, not dataset-derived ones.

**3-D house datasets → the massing grammar.** `scripts/analyze_datasets.py`
mines SYNBUILD-3D-style JSON exports for the *parameter ranges* the archetypes
use — storey counts, footprint solidity (rect vs L/U), floor-to-floor offset /
shrink ratios, roof pitch, opening density — into `scripts/massing_stats.json`
(statistics only; no geometry, no models, no assets are copied). It traces each
storey's outer boundary from the building wireframe (`final_building_points` +
`final_building_adj`) and takes the polygon area vs its bounding box.  COLLADA
(`.dae`) villa exports are also scanned for shape ratios (their scene-graph
transforms aren't composed, so only ratios — not metres — are reported).
SketchUp `.skp` files can't be parsed in this stack; their `.dae` / zip exports
can. The usable numbers are transcribed into `src/lib/engine/massing/stats.ts`;
that file's clamped defaults apply when the JSON hasn't been regenerated.

```bash
python scripts/analyze_datasets.py ~/Downloads/sample_100.zip ~/Downloads/villa.zip
```

Two other datasets were evaluated and **not used**: **LSAA** (CC BY-NC-SA —
non-commercial, and it's European street facades, not architecture assets) and
**Structured3D** (the data is gated behind a signed agreement form). The app is a
deterministic procedural engine with no ML pipeline, so neither could be "wired
in" regardless. Respect the licence of every dataset and model — none is
redistributed here.

## Local AI interiors (ComfyUI)

Step 5 → **AI Interior** builds a clean 3D shell of the selected room (real walls,
doors, windows, ceiling height) from **two camera angles**, captures an **edge**
map from each, writes a prompt from the room type + dimensions + openings + chosen
style, and conditions **SDXL txt2img + a Canny ControlNet** so the photoreal
result keeps the actual geometry while the prompt furnishes the room. One render
job runs per angle. It runs on a **local ComfyUI** — no per-image cost.

Provider is picked by `INTERIOR_PROVIDER` (`comfyui` | `gemini` | `mock`,
default `comfyui`). With ComfyUI unreachable it falls back to `mock` (echoes the
3D render) so the flow still works.

**Set up ComfyUI:**

1. Install [ComfyUI](https://github.com/comfyanonymous/ComfyUI) and start it.
   On a 6 GB GPU launch with **`python main.py --fp8_e4m3fn-unet`** — the fp8
   UNet stays resident so an 8-step render is ~20-25 s (vs ~80 s under
   `--lowvram` weight streaming; don't use `--lowvram` or
   `--fast fp16_accumulation` on a small card). Default `http://127.0.0.1:8188`.
2. Put a **SDXL checkpoint** in `ComfyUI/models/checkpoints/` (a Lightning /
   Turbo finetune like RealVisXL Lightning works best at the low step count)
   and a **Canny ControlNet-SDXL** model in `ComfyUI/models/controlnet/`.
3. In `server/.env` set `COMFYUI_URL`, `SDXL_CKPT` and `CN_CANNY_MODEL` to
   match. Sampling knobs (`INTERIOR_STEPS`, `INTERIOR_CFG`, `CN_CANNY_STR`,
   `INTERIOR_WIDTH/HEIGHT`) are optional.
4. `npm run dev`, open Step 5 → **AI Interior**, pick a room + style → **Generate**.
   The **Second camera angle** toggle trades ~2× time for a second view.

The ComfyUI graph is `server/workflows/interior-sdxl.json` (LoadCheckpoint →
Canny ControlNetApplyAdvanced → txt2img KSampler); swap the whole backend by
adding a module to `server/providers/` with the same
`{ id, healthy, generateInterior }` shape.

## Roadmap

- [x] Shell + theme + landing
- [ ] Guided brief (8 steps) → canonical model
- [ ] Deterministic layout engine — one rectangular typology
- [ ] Validation rule packs + cost engine
- [ ] 2D SVG drawing set
- [x] 3D massing
- [x] AI building concepts (Gemini, grounded on the massing)
- [x] AI interior renders (SDXL + ControlNet via local ComfyUI)
- [ ] Advisory LLM
- [ ] Deck / PDF export

> Concept & feasibility only. A licensed architect and engineers must verify any
> output before permits or construction.
