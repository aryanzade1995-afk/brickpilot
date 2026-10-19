# Solar BOQ and preliminary energy — assessment v1

This stage supersedes the earlier solar documents' statements that solar has no
pricing effect. Building geometry, architectural seeds, finish/render signatures,
pinned design, plan edits and accepted GLB remain independent of solar costing.

## Persistence and assessment identity

`brief.solar.assessmentInputs` is a strictly validated, versioned user-input
extension: objective, explicit historical-allowance treatment, electrical
datasheet/stringing inputs and energy-resource/loss basis. Unknown inputs are
null (or `unknown` for categorical choices); there are no pretend verified site
or resource defaults. These inputs are separate from calculated cost/energy.

Assessment-only edits do not change `solarConfigurationSignature`, which binds
panel placement. They do change `solarSignature` and the pricing replay key.
Untouched historical default configurations preserve their historical replay
keys. Preview/Apply keeps the exact existing valid layout when only assessment
inputs change. Solar-only updates refresh cost, preserving building references.
Save/reload, project switch and version restore re-evaluate against the live roof.

## Pricing gate and historical allowance

- Installation quantities require install-now, a saved/applied canonical V2
  layout, a concept-valid flag **and** a successful current-roof review using
  actual accepted architecture. The flag alone is never trusted.
- Without roof context (including partial/shared model consumers), configured
  PV cannot contribute installed quantities. A current estimate is recomputed
  instead of replaying an old installed-system snapshot.
- Undecided + historical `specs.overrides.solar=on` preserves the existing
  INR 250,000 provisional allowance unless explicitly excluded. No panels,
  capacity or generation are invented from that allowance. Its old tax behavior
  and rate are retained for historical estimates.
- Applied configured PV suppresses the old recipe entirely. Missing/stale PV
  never falls back to that allowance. Not-included and reservation modes do not
  charge it, even though the historical selection remains stored.
- Finish comparison prices use the same current PV scope on both sides.

## Internal concept rate pack

`formstead-solar-concept-v1`, 2026-10-19; reference location Pune, Maharashtra.
These are **internal concept allowances**, not verified current market prices,
vendor quotations, official SOR rates or scheme benchmark costs. Other locations
still show this reference basis and require a local quotation.

| Component | Direct pre-tax planning basis |
| --- | --- |
| Modules | Actual applied count × module W × INR 19/W |
| Grid inverter | Max(INR 16,000, actual DC kWp × INR 7,500) pending selection; when concept compatibility passes, use supplied AC kW for the same allowance rate |
| Mounting | INR 2,200/panel low-tilt allowance; INR 3,500/panel raised frame; unknown choice explicitly pending |
| DC/AC wiring/conduit | INR 2,400 per actual applied kWp allowance; no fictitious cable lengths or sizes |
| Isolation/SPD/circuit protection | INR 7,000 package allowance |
| Dedicated PV earthing/bonding | INR 6,000 allowance; additional PV scope, separate from house earthing |
| Installation labour | INR 3,500 per actual applied kWp |
| Testing/commissioning/transport | INR 2,000 material + INR 2,500 labour allowance |

Modules/materials and labour are not counted twice. Gross solar installation is
the sum of direct solar rows before shared project overhead, contingency and fees.
Existing project add-ons remain explicit. The general project GST provision
excludes new PV and its attributable overhead/contingency until a solar tax basis
exists; it does not assign a guessed solar tax rate. Unconfirmed solar taxes,
structural strengthening, major civil work, battery/backup, utility charges,
net-meter fees/upgrades, maintenance and replacement costs are excluded.

Government assistance is always separate and **INR 0 deducted** from the main
total. The official [PM Surya Ghar portal](https://pmsuryaghar.gov.in/) is provided
for current eligibility, vendor, equipment, DISCOM and application requirements.
The app does not determine eligibility or promise approval/payment.

## Inverter compatibility scope

An unnamed/unspecified inverter remains a clearly labelled allowance. Optional
electrical inputs must include module/inverter source URLs, module specification
key, model/revision, cell temperature bounds, Voc/Vmp coefficients, electrical
ratings, series/parallel stringing and matching supply/inverter phases.

The supported screen checks every panel is represented, cold Voc < maximum DC
voltage, hot/cold Vmp inside the MPPT window, a conservative hot Vmp start check,
parallel Imp/Isc below supplied input limits, maximum DC capacity and an internal
concept DC/AC ratio envelope of 0.8–1.5. It supports one inverter / one MPPT with
uniform array orientation only. Unsupported/inconsistent data stays pending or
incompatible; it is not relabelled a compatible installed product.
Module Vmp × Imp must also agree with the versioned rated wattage within a 5%
concept tolerance; the datasheet fields cannot silently refer to a different module.

These are user-datasheet concept checks, not certified electrical design.
Protection sizing, derating, grid approval, installation and structural checks
remain installer work. No manufacturer specification is fabricated by the app.

## Energy model and unknowns

Annual screening model (versioned assessment v1):

`AC kWh/year = applied DC kWp × annual POA kWh/m² / reference 1 kW/m² × non-shading performance factor × (1 − shading loss)`

Model basis: [Weather-Corrected Performance Ratio, NREL/NLR](https://research-hub.nlr.gov/en/publications/weather-corrected-performance-ratio/).
The aggregate non-shading factor must exclude shading to avoid counting that
loss twice. Temperature, inverter and other non-shading losses are represented
in that sourced/user-provided factor; they are not independently simulated.

Requirements: current valid applied layout, project latitude/longitude, known
true north, one actual array azimuth/tilt, matching resource coordinates and
orientation, source URL, reference period, weather/uncertainty explanation,
annual POA range, non-shading factor range and shading-loss range.

Lower scenario combines low irradiation, low performance and high shading;
upper combines high irradiation, high performance and low shading. Bounds round
outward to 10 kWh. This is a preliminary scenario range, not a statistical
confidence interval, hourly simulation or bankable yield forecast. Unknowns,
mismatches or mixed orientations produce insufficient information, not zero
production. No data is inferred from road facing or decorative 3D shadows.
The scenario assumes an available grid, without export-limit curtailment or inverter
downtime. Grid-outage losses and battery/backup dispatch are not simulated.

Optional monthly consumption is explicitly kWh. Annual consumption = 12 × that
input, not the rupee bill. No tariff, export, self-consumption, ₹ savings,
payback or seasonal demand model is implemented.

## Backup objective

Goal choices: unknown, bill savings, outage backup or both. Ordinary grid-connected
PV shuts down on grid loss; see [SMA's technical explanation](https://www.sma.de/en/home/solar-system-power-outage).
When backup is requested, the current grid-connected scope is explicitly
incomplete for that objective: hybrid/battery, isolation/transfer equipment and
critical-load design remain pending and unpriced. No battery capacity, runtime
or backup cost is invented.

## Delivery and verification

Specifications and Estimate share the summary. Actual solar rows feed electrical
trade totals and main project totals; CSV, Excel (including Solar assessment
sheet), main PDF, specification PDF and saved/public cost schemas carry the same
assessment. Solar snapshot arithmetic rejects mismatched subtotals, double-counted
legacy allowances and unapplied installed inventory.

`npm run test:solar-cost` covers gating, stale/forged roofs, historical allowances,
quantity/rate reconciliation, taxes/subsidy separation, assessment identity,
positive/insufficient energy scenarios, inverter voltage/current/string/phase
checks, persistence and exports. Existing solar placement/state/editor/viewer
tests now assert the updated price behavior while preserving architecture.
