# Modern villa photo reference dataset v1

20 real photographs of 10 buildings. No AI images are included.

## Categories

| Reference type | Style | Photos |
| --- | --- | --- |
| large-villa | contemporary | 1 |
| large-villa | courtyard | 1 |
| large-villa | modern-box | 5 |
| villa-bungalow | contemporary | 2 |
| villa-bungalow | courtyard | 3 |
| villa-bungalow | modern-box | 8 |

## Contents

`images/real/<building-type>/<style>/`: licensed photo files.
`manifest.csv` and `manifest.json`: labels, dimensions, creators, source URLs, licences and SHA-256 checksums.
`LICENSES.md`: per-photo attribution and licence links.
`index.html`: standalone offline gallery; open after extracting the ZIP.

## Collection and use

Discovery used Google Search and Wikimedia Commons search/image metadata APIs. Photos were downloaded from Wikimedia Commons, not from Google thumbnails. All selected previews were visually inspected. No AI-generated images or unknown-licence images are included.

This is a small architectural reference dataset. Some buildings are historical modernist precedents. Contemporary is an application reference grouping, not a claim about construction date. Villa/bungalow and large-villa labels are approximate reference groupings; verified floor areas, room counts and dimensions are unknown. No photographed building is guaranteed to match the application grammar exactly.

Use for browsing, style inspiration and prototyping retrieval. It is too small and too concentrated on a few buildings to claim a general-purpose trained villa generator. Multiple views of the same building share group_id: split by building when expanding into a training/evaluation dataset, to avoid leakage. No fabricated training/test split is supplied.

Real photos cannot establish floor plans, structural safety or buildability. Generated 2D/3D plans remain governed by the application validators.

## Search record

[Google discovery query](https://www.google.com/search?q=modern+villa+exterior+photographs+site%3Acommons.wikimedia.org)

All direct file sources are preserved in the manifests and LICENSES.md.