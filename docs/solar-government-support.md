# Government support card — reviewed 19 October 2026

The Rooftop Solar specification section has a compact Government support card
in the existing Formstead theme. The full guide, self-check, source links and
equipment descriptions expand on demand. English, Hindi and Marathi use the
existing translation system and native keyboard-accessible controls.

## Rules and verification

`src/lib/solar/data/pm-surya-ghar.v1.json` is separate from presentation. It records
rule version/revision, official sources and verification dates, consumer categories,
capacity bands, special-state codes, conditions and the published scheme period.
`governmentSupport.ts` validates amounts, official HTTPS hosts, dates and references.

Reviewed sources:

- [MNRE residential CFA guidelines](https://cdnbbsr.s3waas.gov.in/s3716e1b8c6cd17b771da77391355749f3/uploads/2024/07/202407021768035484.pdf), sections 5–6.
- [MNRE amendment, 7 July 2025](https://mnre.gov.in/en/notice/amendment-in-guidelines-for-implementation-of-pm-surya-ghar-muft-bijli-yojana-for-the-component-of-cfa-to-residential-consumers/), including state-support and technical-rule clauses. The first two scanned pages were visually read; the appended original guidelines were not mistaken for the amendment itself.
- [MNRE DCR clarification](https://mnre.gov.in/en/notice/domestic-content-requirement-dcr-norms-for-solar-pv-cells/), visually read.
- [MNRE/PIB 2026 equipment-policy clarification](https://www.pib.gov.in/newsite/erelcontent.aspx?lang=2&reg=48&relid=289229).
- [MNRE/PIB residential eligibility and National Portal update, March 2026](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2244670&lang=1&reg=3).
- [Official MSEDCL guidance](https://www.mahadiscom.in/ismart/). The current PM Surya Ghar section is distinguished from legacy Phase-II percentage tables also present on that page. Old tender prices, tax notes and Phase-II tables are not imported into the estimate or this rule pack.

Individual consumer-owned CAPEX guidance, including loan-funded consumer-owned
systems: general-state CFA of INR 30,000/kWp for the first 2 kWp, then INR 18,000/kWp
for the next 1 kWp, maximum INR 78,000. Special-state equivalents are INR 33,000,
INR 19,800 and INR 85,800. Fractional eligible installed DC module capacity is
pro-rata; extra capacity beyond 3 kWp receives no further central assistance.
Inverter size and requested concept capacity do not determine CFA.

Association common-facility support has its own 500 kWp / 3 kWp per dwelling
capacity limit, inclusive of individual rooftop systems within the limit. The card
directs associations to official review rather than calculating an unsupported
balance. Non-residential consumers are outside this residential CFA component.
RESCO / utility-owned systems require separate guidance and are not assessed here.

DCR means domestic modules made with domestic cells. Actual equipment must satisfy
applicable ALMM, inverter and current technical requirements; no illustrative
module or passed geometric layout is treated as equipment eligibility evidence.
Prior subsidized systems require an incremental claim review, not another fresh
maximum. Relocation does not create a new entitlement.

No separately verified state financial scheme is implemented in this pack. State
support is explicitly **not assessed**, with null amount and no combined central+
state award. This does not assert that no state schemes exist. Updates adding a
state scheme must carry their own official sources, conditions and review date.

## Applicability and freshness

- Unknown: insufficient self-reported context, association balance, ownership-model
  exceptions, prior assistance or conflicting saved/project state.
- Potentially eligible: individual residential consumer-owned scope appears to fit
  basic self-reported facts. Eligibility **remains unverified**. No official approval
  or equipment compliance is inferred.
- Appears inapplicable: explicit outside-India, non-residential, no-grid/no-roof-right,
  non-DCR or relocation answers explain the issue with this CFA component.
- Outdated information: the app's 90-day review window, the recorded scheme period,
  an invalid clock or a date before verification requires a fresh official check.
  Financial figures are hidden. The app does not claim to reverify automatically.

The 90-day window is a Formstead editorial freshness policy, not a government
deadline or guarantee that rules cannot change sooner. The recorded scheme end
is not presented as a universal application/claim deadline. Transaction-specific
portal changes, legacy claims and approvals remain official-portal work.

MSEDCL links appear only for explicitly Indian Maharashtra guidance contexts and
MSEDCL/unknown distributor. Unknown distributor is labelled conditional. Another
supplier or state suppresses the link. Pune reference rates never imply location.

## Persistence and privacy

Non-sensitive self-check choices live in
`brief.solar.assessmentInputs.governmentSupport`, not in geometry or panel placement
identity. They use existing solar draft Preview / Apply / Cancel behavior. Valid
canonical panels and current BOQ totals remain unchanged. Save/reload and version
restore retain the choices. Malformed optional self-check data resets to unknown
without discarding the prior goal, electrical/energy basis or panel layout.

No government application, identity, bank, document upload or credential field is
implemented. The Apply/check link is exactly `https://pmsuryaghar.gov.in/`, opens
externally, and contains no project or user data. Formstead identifies itself as
independent planning guidance, not a government service. Assistance is not deducted
from gross solar or project cost; no zero bill, award or payment timing is promised.

`npm run test:solar-government` covers official-source validation, all applicability
states, freshness, geographic/supplier routing, prior claims, ownership scope,
schema privacy, translations, existing panels/cost identity, reload and versions.
