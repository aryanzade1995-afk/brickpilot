# Rooftop solar controls

> Pricing update: [Solar BOQ and energy assessment v1](solar-cost-energy.md) supersedes this stage's no-cost-change statements. Applied valid PV now updates the estimate; architecture and accepted building render stay independent.

Specifications includes an explicit `rooftop-solar` navigation section. It is
independent of the catalogue's photographed options and does not expose Extras.
The Massing Add/Edit shortcut links to
`/workspace/finishes?tab=specifications&section=rooftop-solar`.
Existing room query parameters are retained when switching sections; solar always
shows Whole home and disables the room filter.

The editor clones the project's solar settings into a local draft. Preview uses
the shared roof and deterministic placement engine; it does not write to Brief,
regenerate architecture, or request rendering. The diagram shows actual top-roof
boundaries, openings, roof obstacles, protected access, reservations and panels.
Illustrative module presets are explicitly labelled; unknown optional values stay
null. Resolved concept assumptions can be inspected in the preview.

Apply saves the validated inputs and canonical proposed layout together through
the FinishesCost onBrief path. It checks roof/allocation signatures again before
saving. If no layout is available, the user can save preferences without claiming
installed panels. An unchanged saved layout survives a temporarily unavailable
source. A changed roof requires another Preview. Manual mode preserves existing
canonical manual positions; this section does not introduce a drag editor.

Cancel discards the local draft. Remove solar drafts a not-included intention but
keeps specification and sizing inputs for later re-enabling. Reset solar drafts
the undecided configuration; both require Preview and Apply. Reservation mode can
reserve a real clear roof rectangle, creates no panels and adds no installation
cost. It can be cleared separately. Finish reset and finish-level changes retain
the structured solar configuration and historical solar allowances.

The accepted architecture is required for a usable roof summary. Missing or
unsupported roof geometry produces an explanatory preview, not fabricated space.
This step provides a 2D concept preview and persistent controls; it does not add
3D panels or new cost/generation/subsidy calculations. Existing provisional
allowances stay separate. English, Hindi and Marathi labels use the shared
translation layer. Native labelled fields, details disclosures, live status/error
text and responsive Formstead tokens support keyboard and narrow-screen use.

Validation: `npm run test:solar-editor`, the solar state/roof/placement suites,
`npm run build`, `npm run lint`, and browser checks of navigation, draft controls,
reload persistence, room scope and language switching.
