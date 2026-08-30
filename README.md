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
