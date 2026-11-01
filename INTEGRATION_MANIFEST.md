# Social Impact Integration Manifest

This document specifies the exact integration contracts, touched files, imports, state bindings, and verification steps for merging the Social Impact module into any branch or fork of BrickPilot.

---

## 1. Destination File Mapping

| Source File in Module | Destination in Project | Purpose |
| :--- | :--- | :--- |
| `src/lib/impact/analysis.ts` | `src/lib/impact/analysis.ts` | Core domain engine: water balance simulation, solar financials, carbon deltas, accessibility audit, PMAY-U 2.0 eligibility. |
| `src/lib/impact/summary.ts` | `src/lib/impact/summary.ts` | Single Source of Truth (`buildImpactSummary`): derives every KPI, sub-score, headline, and chart series. |
| `src/lib/impact/schema.ts` | `src/lib/impact/schema.ts` | Zod schema defining the serializable `ImpactDocument`. |
| `src/lib/impact/sampleProject.ts` | `src/lib/impact/sampleProject.ts` | Instant-load sample project (Pune 4BHK Eco-Villa) for `?sample=true` or fresh sessions. |
| `src/lib/impact/data/cityRainfall.json` | `src/lib/impact/data/cityRainfall.json` | IMD precipitation database for 50+ Indian cities. |
| `src/lib/impact/data/nationalStandards.ts` | `src/lib/impact/data/nationalStandards.ts` | Benchmark factors: NBC 2016, Jal Shakti, Eco-Niwas Samhita, PM Surya Ghar, DEPwD 2021. |
| `src/components/impact/*` | `src/components/impact/*` | 5 Pillars (`Affordability`, `WaterSecurity`, `ClimateSolar`, `Accessibility`, `Community`), `ImpactHeroBanner`, `LazyPillar`, `PillarErrorBoundary`, and all SVG chart primitives. |
| `src/routes/SocialImpact.tsx` | `src/routes/SocialImpact.tsx` | Main page view, sticky scroll-spy navigation rail, tab state synchronizer. |
| `src/state/socialImpact.ts` | `src/state/socialImpact.ts` | Persistent Zustand store under key `brickpilot-social-impact`. |
| `scripts/test-social-impact.mjs` | `scripts/test-social-impact.mjs` | 25-assertion node test suite validating calculation fidelity. |

---

## 2. Integration Touchpoints in Host Project

### A. Router Registration (`src/main.tsx` or `src/lib/workspacePages.ts`)
Check if `/workspace/impact` is already wired in your router:
- In `src/lib/workspacePages.ts`:
  ```ts
  '/workspace/impact': () => import('../routes/SocialImpact.tsx'),
  ```
- In `src/main.tsx`:
  ```tsx
  const SocialImpact = page(workspacePages['/workspace/impact'], 'SocialImpact')
  // Under workspace children:
  { path: 'workspace/impact', lazy: SocialImpact },
  ```

### B. Navigation Bar (`src/components/WorkspaceTabs.tsx`)
Ensure the tab is present in `TABS`:
```tsx
{ to: '/workspace/impact', label: 'Social Impact', n: '09' },
```

### C. Test Script (`package.json`)
Add under `"scripts"`:
```json
"test:social-impact": "node --experimental-strip-types --test scripts/test-social-impact.mjs"
```

---

## 3. Host State Dependencies (Read-Only Boundaries)

The module consumes the following existing BrickPilot stores without altering them:
1. `useStudio`:
   - Reads: `s.result` (`CanonicalModel`, `Design`, `ValidationReport`, `CostEstimate`), `s.brief`, `s.run`.
2. `useFinishes`:
   - Reads: `s.entries[geometryCostKey(result.design)]` for active material selections.
3. `useCostResearch`:
   - Reads: `s.location.city` for municipal rainfall lookup.
4. `useLanguage`:
   - Reads: `s.language` for localized UI strings (`translate` / `t`).

---

## 4. Controlled Write Boundary (`[Apply to BOQ]`)

The **only** state mutation performed anywhere in the Social Impact module occurs inside `src/components/impact/AffordabilityPillar.tsx` when a user clicks `[Apply to BOQ]`:
```ts
// 1. Resolve catalogue specification
const nextBrief = applySpecification(originalBrief, cost, item, swap.alternativeOptionId, ...)

// 2. Commit update to brief
useStudio.getState().edit(b => {
  b.specs.overrides = nextBrief.specs.overrides
})

// 3. Mark project change
noteChange(`Applied Eco-Swap: ${swap.label} -> ${swap.alternative}`)
```
All other interactions (tank sliders, cool roof toggles, solar inputs) save strictly into the isolated `useSocialImpact` store.

---

## 5. Verification Protocol

Run the three verification gates:
```bash
# Gate 1: Comprehensive domain tests (25/25 passing)
npm run test:social-impact

# Gate 2: Static analysis
npm run lint

# Gate 3: TypeScript & Vite production build
npm run build
```
Once clean, open `http://localhost:3000/workspace/impact?sample=true` to verify live rendering.
