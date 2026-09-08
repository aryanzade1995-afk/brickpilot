# BrickPilot — architectural reference dataset + design DNA

**The images are not the data.** The data is the *structured architectural
DNA* extracted from every reference — massing, floor composition, roof, entrance,
balconies, facade, glazing, courtyard — expressed in one controlled vocabulary
that the runtime generator (`src/architecture/library/`) and this offline pipeline
both draw from.

The dataset feeds BrickPilot's generator as a **soft bias** on the seeded
[Design Genome](../src/architecture/library/designGenome.ts): a reference nudges
the architectural picks toward real, buildable compositions. It never overrides
the user's plot, room programme, floor count or setbacks.

```
USER REQUIREMENTS -> STYLE -> reference library (bias) + style grammar
                  -> DESIGN GENOME (seeded, compatibility-checked)
                  -> architectural fingerprint
                  -> floor plan -> massing -> floors -> roof -> balconies
                  -> entrance -> windows -> facade -> materials
                  -> BLENDER procedural generator -> GLB/GLTF -> three.js viewer
```

## Layout

```
brickpilot-architecture-dataset/
├── images/                       (gitignored — populated by harvest / user drop)
│   ├── modern_indian/  contemporary_indian/  modern_kerala/  kerala_contemporary/
│   ├── luxury_indian/  tropical_indian/  courtyard/  minimalist/
│   ├── cantilever/  rooftop_terrace/  sloped_roof/  mixed/
│   └── international/             (§13 — composition references, never a target style)
├── metadata/
│   ├── vocabulary.json           the term taxonomy      (from sync-vocabulary.mts)
│   ├── compatibility.json        incompatibilities + affinities + figure↔massing
│   ├── styles.json               per-style genome distribution + element libraries
│   ├── genomes.json              650+ synthetic Design Genomes (from genome-corpus.mts)
│   ├── queries.json              search queries          (from generate_search_queries.py)
│   └── designs.json              THE MASTER RECORD — every reference's DNA + fingerprint
├── raw/                          (gitignored — downloads land here before analysis)
├── reports/
│   └── dataset_report.json       §10 quality report
├── scripts/
│   ├── generate_search_queries.py   §12  style × massing × roof × facade × entrance × balcony
│   ├── collect_references.py        §2   Openverse + Wikimedia Commons, licence-aware
│   ├── analyze_reference.py         §8   image → structured DNA (AI vision or heuristic)
│   ├── build_fingerprints.py        §9   dHash + architectural fingerprint (mirrors fingerprint.ts)
│   ├── deduplicate.py               §9   perceptual + architectural dedup
│   ├── generate_metadata.py              assemble designs.json (synthetic + harvested + user)
│   └── validate_dataset.py          §10  quality gate → dataset_report.json
├── README.md · SCHEMA.md · LICENSES.md
```

## Build the dataset

```bash
# 1. sync the vocabulary + style patterns from the TS libraries (single source of truth)
npx tsx scripts/sync-vocabulary.mts

# 2. generate the 650+ synthetic design genomes (the core "data")
npx tsx scripts/genome-corpus.mts --target 650

# 3. (optional) harvest open-licensed reference photos
python brickpilot-architecture-dataset/scripts/generate_search_queries.py
python brickpilot-architecture-dataset/scripts/collect_references.py --dry-run
python brickpilot-architecture-dataset/scripts/collect_references.py --yes --limit 150 --permissive-only

# 4. assemble + fingerprint + dedup + validate
cd brickpilot-architecture-dataset/scripts
python generate_metadata.py         # merges synthetic genomes + any harvested / user images
python build_fingerprints.py        # dHash + architectural fingerprint
python deduplicate.py               # drop perceptual + architectural near-duplicates
python validate_dataset.py          # §10 gate → ../reports/dataset_report.json
```

You can also drop your own photos straight into `images/<bucket>/` and re-run
step 4 — `generate_metadata.py` analyses and records them (`licenseStatus =
user_provided`).

## Sources & licensing (§2)

`collect_references.py` searches **only** open / permissive sources:

| source | licences kept | status |
|---|---|---|
| Openverse | CC0, PDM, CC-BY, CC-BY-SA | `verified_open` / `verified_permissive` |
| Wikimedia Commons | public domain, CC0, CC-BY, CC-BY-SA | `verified_open` / `verified_permissive` |

Google Images is used for **discovery of search terms only** — never scraped.
Anything whose licence cannot be verified is stored with
`licenseStatus = "unknown"` and is **never** treated as a commercial-use asset.
See `LICENSES.md`.

## Synthetic genomes (§14)

`genomes.json` holds 650+ **Design Genomes**, each a real `resolveGenome()`
output — the exact architectural vocabulary BrickPilot can procedurally build,
across a spread of realistic Indian plot programmes (30×50 → 60×90 ft, G → G+2),
deduplicated by architectural fingerprint. They are not random AI houses: every
one is a compatible composition of massing + roof + entrance + balcony + facade +
courtyard decisions. Distribution (current build):

- 8 / 8 massing compositions · 11 / 11 roof forms · 8 / 8 facade compositions
- all 8 target styles, 51–100 genomes each

## How the dataset influences generation (§15, §16)

`src/architecture/library/designLibrary.ts` → `referenceHints(style, planShape)`
turns the reference DNA into extra `[term, weight]` picks concatenated onto the
style pattern before `resolveGenome()` samples. International references
(`images/international/`) only expand *composition* vocabulary (massing, facade,
screen) — never the style-defining roof / entrance / material / courtyard picks.

The user's requirements are resolved separately and always win: the genome adapts
to the plot, it never forces a reference footprint into an incompatible plot.
