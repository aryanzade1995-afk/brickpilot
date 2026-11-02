# Antigravity Prompt: Safe Integration of Social Impact Feature

> **Instructions for your friend:**  
> Copy and paste the prompt below directly into your Antigravity chat window. Your Antigravity agent will follow the step-by-step protocol to read your project, compare it with the Social Impact module, and merge the feature cleanly without touching or harming your existing modifications.

***

```markdown
# TASK: Integrate Visual Social Impact Module into BrickPilot (Zero-Regression Protocol)

You are Antigravity, Principal Systems Integrator. Your mission is to integrate the complete Visual Social Impact module (`/workspace/impact`) into this BrickPilot repository without modifying, breaking, or clobbering any existing features, custom code, or active experiments.

Before writing or modifying any code, you must execute the mandatory 4-Phase Protocol.

---

## PHASE 1: DISCOVERY & LOCAL CODEBASE AUDIT (Read-First)

Do NOT write code yet. First, inspect this workspace and verify the current state:

1. **Routing & Views:**
   - Inspect `src/main.tsx` and `src/lib/workspacePages.ts`. Is `/workspace/impact` already registered? What is the current route configuration?
   - Inspect `src/components/WorkspaceTabs.tsx`. Is there already a tab for Social Impact?
2. **Core State Stores:**
   - Inspect `src/state/studio.ts`. Confirm the shape of `useStudio.getState().result`, `brief`, `run`, and `edit`.
   - Inspect `src/state/finishes.ts`. Confirm `useFinishes.getState().entries` and `setSelection`.
   - Inspect `src/state/projects.ts`. Note how `noteChange` is imported and used.
3. **Existing Social Impact Files (if any):**
   - Check if `src/lib/impact/` or `src/components/impact/` or `src/routes/SocialImpact.tsx` already exist.
   - Check `package.json` for `"test:social-impact"`.

Record any custom modifications, differing type shapes, or unique changes in this repository.

---

## PHASE 2: MODULE INSPECTION & DIFF ANALYSIS

Inspect the incoming Social Impact module files (provided in `modules/social-impact/` or as an extracted zip):

1. **Domain Engine & SSoT (`src/lib/impact/`):**
   - `summary.ts`: Single Source of Truth (`buildImpactSummary`) returning all KPIs, sub-scores, and chart inputs.
   - `analysis.ts`: Pure calculations (water storage balance, solar yield & subsidy, carbon deltas, accessibility route audit, PMAY-U 2.0).
   - `schema.ts`: Zod schema for `ImpactDocument` with backward compatibility.
   - `sampleProject.ts`: Instant fallback project for `?sample=true` and fresh sessions.
   - `data/nationalStandards.ts` & `data/cityRainfall.json`: Benchmark factors and municipal precipitation tables.
2. **UI & Chart Primitives (`src/components/impact/`):**
   - 5 Pillars: `AffordabilityPillar`, `WaterSecurityPillar`, `ClimateSolarPillar`, `AccessibilityPillar`, `CommunityPillar`.
   - Visual Infographics: `ImpactHeroBanner`, `LazyPillar`, `PillarErrorBoundary`, and all SVG charts in `charts/`.
3. **Route & State:**
   - `src/routes/SocialImpact.tsx`: Page route with sticky scroll-spy rail and instant sample fallback.
   - `src/state/socialImpact.ts`: Isolated store under key `brickpilot-social-impact`.
4. **Verification Suite:**
   - `scripts/test-social-impact.mjs`: 25 comprehensive unit tests.

**Rule of Least Disturbance:** The Social Impact module is designed as an isolated, read-only consumer of `result`, `brief`, `cost`, and `report`. The only write boundary is the `[Apply to BOQ]` button in `AffordabilityPillar.tsx`.

---

## PHASE 3: NON-DESTRUCTIVE INTEGRATION (Clean Copy & Safe Wiring)

Apply the integration following these precise rules:

1. **Copy Module Files:**
   - Place all files from `modules/social-impact/src/lib/impact/` into `src/lib/impact/`.
   - Place all files from `modules/social-impact/src/components/impact/` into `src/components/impact/`.
   - Place `SocialImpact.tsx` into `src/routes/SocialImpact.tsx`.
   - Place `socialImpact.ts` into `src/state/socialImpact.ts`.
   - Place `test-social-impact.mjs` into `scripts/test-social-impact.mjs`.

2. **Wire Route & Navigation (Only if missing):**
   - In `src/lib/workspacePages.ts`: ensure `'/workspace/impact': () => import('../routes/SocialImpact.tsx')` is exported.
   - In `src/main.tsx`: ensure `{ path: 'workspace/impact', lazy: SocialImpact }` is present in router children.
   - In `src/components/WorkspaceTabs.tsx`: ensure `{ to: '/workspace/impact', label: 'Social Impact', n: '09' }` is present.
   - In `package.json`: ensure `"test:social-impact": "node --experimental-strip-types --test scripts/test-social-impact.mjs"` is in scripts.

3. **Adapt Glue If Local Types Differ:**
   - If this repo has altered properties on `CostEstimate` (e.g. `cost.expected` vs `cost.total`), adapt the accessors inside `src/lib/impact/summary.ts` or `src/routes/SocialImpact.tsx`.
   - **DO NOT** edit or refactor any other tabs (Brief, Directions, Massing, Plan, Finishes, 3D Render, Blender, or PDF). Keep them completely untouched.

---

## PHASE 4: VERIFICATION & FALSIFIABLE TESTING

Execute the following verification gates in order and report the terminal results:

1. **Domain Test Suite:**
   ```bash
   npm run test:social-impact
   ```
   Assert that all 25 tests pass (0 failures).

2. **Static Code Quality:**
   ```bash
   npm run lint
   ```
   Assert 0 errors.

3. **Production Build:**
   ```bash
   npm run build
   ```
   Assert `tsc -b && vite build` exits 0 with clean chunk output.

4. **Runtime Verification:**
   - Start or check the dev server (`npm run dev`).
   - Navigate to `http://localhost:3000/workspace/impact?sample=true`.
   - Verify that the page loads immediately with the Pune Eco-Villa sample data, showing all 5 pillars, the Impact Score ring, and live SVG charts without needing any brief generation.

Once verified, provide a concise summary of files integrated and confirmation that all other project workflows remain 100% intact.
```
