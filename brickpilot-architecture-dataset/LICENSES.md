# Licensing policy

## Principle

Every reference must be **legally usable by BrickPilot**. The dataset is
designed so that:

- the *architectural DNA* (vocabulary terms, genomes, fingerprints, statistics)
  is BrickPilot's own work product — CC0 / MIT, use freely;
- *images* carry their original licence, recorded per-file, and are used only
  within that licence.

## What `collect_references.py` accepts

| licence | `licenseStatus` | attribution | commercial | modification |
|---|---|---|---|---|
| CC0 1.0 | `verified_open` | no | yes | yes |
| Public Domain Mark | `verified_open` | no | yes | yes |
| CC-BY 4.0 | `verified_permissive` | **yes** | yes | yes |
| CC-BY-SA 4.0 | `verified_permissive` | **yes** | yes | yes (share-alike) |
| CC-BY-ND | `verified_permissive` | yes | yes | **no** |
| CC-BY-NC* | `unknown` | yes | **no** | — |
| anything else / unverifiable | `unknown` | — | — | — |

`collect_references.py --permissive-only` keeps just the top four rows.

## Unknown-licence images

Stored in `raw/` and recorded with `licenseStatus = "unknown"`. They are:

- **never** promoted into `images/` as usable assets,
- **never** counted toward the commercial-use corpus,
- retained only as *analysis input* to expand the vocabulary statistics, and only
  if you accept that risk.

`validate_dataset.py` reports `unknown_license_count` and docks the quality score.

## Attribution

For every image with `attributionRequired: true`, the `source` record keeps
`creator` + `url` + `licenseUrl`. If BrickPilot ever surfaces a reference image
to a user, it must show that attribution. The generator does **not** surface
images — it only reads the DNA — so attribution obligations are satisfied by
keeping this file and `designs.json` with the distribution.

## Google Images

Used for **discovery only** (finding good search phrases). No image is downloaded
from a Google Images result. `generate_search_queries.py` produces the phrases;
`collect_references.py` runs them against Openverse / Wikimedia Commons.

## Synthetic references

`genomes.json` and any baked synthetic renders are BrickPilot-generated,
released **CC0-1.0**. They contain no third-party content.

## User-provided images

`licenseStatus = "user_provided"`. You are asserting you have the right to use
them. BrickPilot treats them as permissive within your own deployment.
