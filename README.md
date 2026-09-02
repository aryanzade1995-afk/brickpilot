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
