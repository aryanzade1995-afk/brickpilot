# Brand Links Registry

This document describes the external manufacturer and regulatory website reference registry implemented for Formstead finishes and specifications.

## Registry Format

The registry is stored at `src/lib/finishes/brandLinks.json` and validated at build/runtime using Zod in `src/lib/finishes/brandLinks.ts`.

### Entry Shape
```typescript
interface BrandItem {
  name: string
  url: string // https:// only, verified official manufacturer or authority website
  kind: 'brand-home' | 'category-page' | 'product-finder' | 'official-reference'
  note?: string
}

interface RelatedMaterial {
  label: string
  brands: BrandItem[]
}

interface BrandLinkEntry {
  groupId: string // required (matches specsCatalogue 19 groups)
  itemId?: string // optional item-level override
  brands: BrandItem[] // 1-5 verified brands
  relatedMaterials?: RelatedMaterial[] // sub-materials without standalone catalogue items
  verifiedAt: string // ISO date (YYYY-MM-DD)
}

interface NoLinkNeeded {
  itemId: string
  reason: string
}

interface BrandLinksRegistry {
  schemaVersion: 1
  entries: BrandLinkEntry[]
  noLinkNeeded: NoLinkNeeded[]
}
```

Every hostname used in `brandLinks.json` must be present in the domain allowlist file `src/lib/finishes/brand-allowlist.json`.

## Resolution Priority Order (`getBrandLinks`)

When resolving links for a specification item card or option:
1. **Selected Option's Own Provenance**: When `finishProduct` or `flooringProduct` carries a verified `sourceUrl` with `sourceKind` "product" or "collection", it takes precedence.
2. **Item-Level Registry Entry**: Specific item override matching `itemId` (e.g. `cement`, `reinforcement`, `wiring`, `sanitary`).
3. **Group-Level Registry Entry**: Section-wide defaults matching `groupId` (e.g. `foundation-structure`, `electrical`, `plumbing-sanitary`).

### Deduplication & Reordering
- All candidate links are deduplicated by normalized hostname (`new URL(url).hostname.replace(/^www\./, '')`).
- **Paint**: When a specific paint manufacturer is selected (e.g. Asian Paints, Berger, Nerolac, Dulux, Birla Opus), that manufacturer's link is reordered to the front.
- **Flooring & Wall Tiles**: When a specific tile manufacturer is chosen (e.g. Kajaria, Somany, Orientbell, Johnson), that manufacturer's link is placed first.
- **Card UI**: Displays the primary link inline (`View on <Brand> ↗`) plus a `+N more` dropdown popover.
- **Change Drawer**: Displays the complete list with descriptive notes and expandable related materials chips.

## Honesty & Compliance Rules

- **Strict HTTPS**: All URLs must use `https://`. No tracking or affiliate parameters are permitted.
- **User Disclosure**: Every link includes an explicit tooltip and aria-label:
  > *"Opens the manufacturer's website. Prices and availability there may differ from this concept estimate."*
- **Source Nature**: Distinguishes "specific product" (only when `sourceKind === 'product'`) from "brand / collection reference".
- **Zero Financial Impact**: Adding brand links does not modify quantities, rates, geometry, seeds or cost calculations.

## How to Add a Brand

1. **Verify Official Presence**: Verify that the brand URL is an authentic, active official manufacturer portal (category page, home page, or product finder) under HTTPS.
2. **Add Domain to Allowlist**: Add the exact hostname to `src/lib/finishes/brand-allowlist.json`.
3. **Add Entry to Registry**: Insert or extend the corresponding entry in `src/lib/finishes/brandLinks.json`. Ensure no duplicate hostnames exist within the entry.
4. **Run Verification Test**:
   ```bash
   npm run test:brand-links
   ```
5. **Verify Build and Lint**:
   ```bash
   npm run build
   npm run lint
   ```

---

## Unverified / Dropped List

The following URLs and domains were investigated during audit and either could not be verified, experienced network failures, or were replaced by official active domains:

| Brand / Organization | Candidate URL | Status / Reason | Resolution |
|----------------------|---------------|-----------------|------------|
| **SAIL** | `https://www.sail.co.in` | Network fetch failure / TLS handshake issue | Dropped; covered by primary TMT producers Tata Tiscon, JSW Neosteel, Jindal Panther, Kamdhenu, Shyam Steel |
| **Nirali Sinks** | `https://niralisg.com` / `https://niralisinks.com` | Unreachable / expired DNS | Replaced with verified active official domain `https://niraling.com` |
| **Ozone Hardware** | `https://ozone-india.com` | Connection reset / outdated domain | Replaced with verified active portal `https://www.ozone.in` |
| **Kisan Pipes** | `https://www.kisanpipes.com` | Failed network fetch | Replaced with active Kisan Group corporate portal `https://www.kisangroup.com` |
| **Parryware** | `https://www.parryware.com` | Connection failure | Replaced with official India domain `https://www.parryware.in` |
| **Sintex** | `https://www.sintexplastics.com` | Timeout / connection drop | Replaced with official active store `https://www.sintexonline.com` |
| **Plasto Tanks** | `https://www.plasto.in` | DNS / server failure | Replaced with verified active manufacturer site `https://www.rcplasto.com` |
| **Fundermax India** | `https://www.fundermax.com/en-in` | Returned 404 Not Found | Replaced with root architectural portal `https://www.fundermax.com` |
| **Koemmerling** | `https://www.koemmerling.com/in/en` | Returned 404 Not Found | Replaced with verified active portal `https://www.koemmerling.com` |
| **Qutone Ceramics** | `https://www.qutone.com` | Timed out / network abort | Dropped; comprehensive tile coverage via Kajaria, Somany, Orientbell, Johnson, Nitco, Simpolo |
| **Stonex India** | `https://www.stonexindia.net` | Timed out / unreachable | Dropped; marble coverage provided by RK Marble |
| **Lauritz Knudsen** | `https://www.lauritzknudsen.com` | Server connection failure | Switchgear & distribution covered by Schneider Electric, Legrand, Havells, ABB |
| **IFFCO Bazar** | `https://www.iffcobazar.in` | Fetch failure / anti-bot blocking | Landscaping covered by Ugaoo |
