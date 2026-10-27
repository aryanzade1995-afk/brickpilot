# Social Impact workspace

`/workspace/impact?section=dashboard` adds one workspace navigation entry and
twelve switchable views. It reuses the shared design tokens, project, language,
estimate, BuildingModel, ventilation and entrance-ramp systems. It never edits
Brief, seeds, geometry, accepted GLBs or specifications.

## Working capabilities

- Affordability: current BOQ estimate/range, user budget and supported lower-rate
  finish alternatives at the same line quantity and unit. Comparisons do not
  apply changes or claim performance equivalence or combined savings.
- Climate: actual opening-to-opening path summaries for four plan sides; manual
  roof-insulation comparison using `U × area × ΔT` in watts. This is steady-state
  roof conduction, not temperature, full heat-gain, CFD or energy simulation.
- Water: uses existing `rainfallYield()` and `tankStep()`. Required rainfall,
  confirmed area, coefficient, collection efficiency and source stay unknown
  until entered. One event fills an empty tank, spills overflow, then serves one
  entered day's demand. The projected roof quantity is context, never silently
  substituted as the confirmed harvesting area. A changed geometry key marks
  the old area for review. Editing rainfall or tank capacity cannot clear this.
- Sustainability: manual EPD/factor ledger using existing BOQ quantities and
  units; partial kgCO₂e ranges require source, boundary, exact product spec and
  geometry identity. Stale entries are excluded. Different boundaries never
  produce one total. No built-in emission factors or eco certifications.
  A separate entered monthly-kWh comparison is annualised; rupees are not kWh.
- Safety/accessibility: existing non-Vastu planning findings plus explicit
  uncompleted site, electrical, drainage, kitchen and access checks. Nominal
  doorway widths and proposed ramps are facts, not compliance certificates.
- Community: household prototype cost multiplication plus a separately entered
  shared-services allowance. No site layout, batch-generated homes, bulk-discount
  prediction, NGO eligibility, land costing or construction approval is implied.
- Assistant: deterministic multilingual intent guidance with project context
  and a link to the existing room voice guide. No new LLM endpoint, independent
  AI engineering assessment or external data transmission is introduced.
- Essential tools: direct links to existing planning, visualization, costing
  and water tools without introducing a new payment gate. This does not change
  deployment/authentication policy or assert universal offline availability.
- Dashboard/pilots: no seeded impact data. Anonymous household codes, dated
  evidence notes, comparable baseline/actual costs, measured water and resilience
  notes can be recorded. Latest dated record per normalised code counts once.
  Supported records without evidence do not count. Outcomes remain user-reported
  and not independently verified; no scientific resilience score is invented.

## Files and persistence

- `src/lib/impact/schema.ts`: validated version 1 input document.
- `src/lib/impact/analysis.ts`: read-only calculations and review projection.
- `src/state/socialImpact.ts`: persisted working companion document, with
  storage-failure reporting. Project `Core.socialImpact` preserves it through
  normal saves, autosave, duplicates, switching, export and version restore.
  Old snapshots default to null and cannot inherit another project's inputs.
- `src/routes/SocialImpact.tsx`: responsive views and accessible native inputs.
- `src/lib/i18n/impactMessages.ts`: Hindi and Marathi copy using existing language
  controls. Buttons support keyboard activation; links expose related tools.
- `scripts/test-social-impact.mjs`: formula, evidence, stale-data, identity and
  persistence regression tests; run `npm run test:social-impact`.

Inputs commit on field blur and save with the project. The page also downloads a
qualified JSON impact record containing inputs, calculations, source geometry,
user-reported outcomes and review notes. It contains no generated certification.

## Guidance checked 28 October 2026

- [BEE residential envelope guidance](https://www.beeindia.gov.in/show_content.php?lang=1&level=2&lid=328&ls_id=202)
- [DEPwD universal accessibility guidelines](https://depwd.gov.in/en/document/harmonised-guidelines-standards-for-universal-accessibility-in-india-2021/)
- [Jal Shakti rainwater references](https://jsactr.mowr.gov.in/Public_Dash/KnowledgeCentre.aspx)

No numeric regulatory thresholds or subsidy rules were introduced. Applicable
local requirements and professional engineering review remain separate.

## Verification

The new calculation and persistence suite passes, along with the existing water
persistence suite. Production TypeScript/Vite build and focused lint pass.
The broader project-history suite has an existing balcony-geometry restoration
failure at `scripts/test-projects.mjs:127`; it also reproduces when importing the
original HEAD project-state module without this feature. Social Impact's own
save, reload, duplicate, switching and version restoration tests pass.
