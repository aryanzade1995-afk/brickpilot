# Languages and building shapes

The header language selector offers English, Hindi and Marathi. It saves only
`formstead.language`; switching languages leaves project data, form values,
geometry, selected materials and prices untouched. Translation happens in React
presentation components. No online translation service is used. The document
language and Devanagari font stack change with the selected language.

`src/lib/i18n/messages.ts` and `extraMessages.ts` contain Hindi and Marathi copy
keyed by the English presentation string. Parameterized messages use `{0}`, `{1}`,
etc. Unknown server messages and catalogue/product names fall back to the source
text. Downloaded technical sheets retain their existing export language.

In 3D Massing, **New building shape** replans occupied floor plates and validates
the resulting rooms, doors, windows, stairs and architectural envelope before
replacing the current plan. Its exact Blender model must also finish successfully
before the replacement is committed. The old villa remains visible while it
renders, and a failed replacement keeps the old plan, pin and room edits.
The 2D plan and Blender input use that same source.
Existing Structure Mode does not offer footprint replacement.

Shape identity uses the union of occupied plates on every floor. Translation on
the plot, partitions, family labels, seeds, materials and facade accessories do
not count as new shapes. Candidates must differ by at least 12% union area from
the current and remembered shapes. Up to 1,000 shape records persist locally.
The search retains the current design when site/programme constraints prevent
a fresh valid shape. This is a bounded search, not a promise of unlimited shapes
for every fixed brief.

**New exterior on this plan** keeps the verified floor plan and uses the modern
seed library for exterior variants. **Refresh current design** re-renders the
same plan and seed, including updated renderer details and render quality.

The main-entry EXIT plaque and lettering are omitted by both 3D renderers.
Secondary-exit signs and the semantic 2D escape plan remain available.

Checks: `node --experimental-strip-types --test scripts/test-i18n.mjs scripts/test-building-shapes.mjs`.
