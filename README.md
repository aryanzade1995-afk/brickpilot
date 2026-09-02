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
| Backend *(later)* | Express + Supabase |

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

## Local AI interiors (ComfyUI)

Step 5 → **AI Interior** builds a clean 3D shell of the selected room (real walls,
doors, windows, ceiling height, camera), captures a **depth** map and an **edge**
map from it, writes a prompt from the room type + dimensions + openings + chosen
style, and conditions **SDXL + ControlNet** so the photoreal result keeps the
actual geometry. It runs on a **local ComfyUI** — no per-image cost.

Provider is picked by `INTERIOR_PROVIDER` (`comfyui` | `gemini` | `mock`,
default `comfyui`). With ComfyUI unreachable it falls back to `mock` (echoes the
3D render) so the flow still works.

**Set up ComfyUI:**

1. Install [ComfyUI](https://github.com/comfyanonymous/ComfyUI) and start it
   (`python main.py`, default `http://127.0.0.1:8188`).
2. Put an **SDXL checkpoint** in `ComfyUI/models/checkpoints/` and two
   **ControlNet-SDXL** models (depth + canny/lineart) in
   `ComfyUI/models/controlnet/` — e.g. Stability's `control-lora-*-rank256`.
3. In `server/.env` set `COMFYUI_URL` and the model file names
   (`SDXL_CKPT`, `CN_DEPTH_MODEL`, `CN_CANNY_MODEL`) to match. Sampling knobs
   (`INTERIOR_STEPS`, `INTERIOR_CFG`, `INTERIOR_DENOISE`, `CN_*_STR`) are optional.
4. `npm run dev`, open Step 5 → **AI Interior**, pick a room + style → **Generate**.

The ComfyUI graph is `server/workflows/interior-sdxl.json` (LoadCheckpoint →
2× ControlNetApplyAdvanced → img2img KSampler); swap the whole backend by adding
a module to `server/providers/` with the same `{ id, healthy, generateInterior }`
shape.

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
