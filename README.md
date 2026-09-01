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

## Roadmap

- [x] Shell + theme + landing
- [ ] Guided brief (8 steps) → canonical model
- [ ] Deterministic layout engine — one rectangular typology
- [ ] Validation rule packs + cost engine
- [ ] 2D SVG drawing set
- [ ] 3D massing
- [ ] AI renders + advisory
- [ ] Deck / PDF export

> Concept & feasibility only. A licensed architect and engineers must verify any
> output before permits or construction.
