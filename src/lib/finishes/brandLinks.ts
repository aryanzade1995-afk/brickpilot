import { z } from 'zod'
import raw from './brandLinks.json' with { type: 'json' }
import allowlistRaw from './brand-allowlist.json' with { type: 'json' }
import { specsCatalogue } from '../cost/catalogue.ts'
import { finishProduct } from './catalogue.ts'
import { flooringProduct } from '../flooring/catalogue.ts'
import type { SpecItem, SpecOption } from '../cost/workspace.ts'
import type { CostEstimate } from '../cost/boq.ts'

export const brandLinkKindSchema = z.enum([
  'brand-home',
  'category-page',
  'product-finder',
  'official-reference',
])
export type BrandLinkKind = z.infer<typeof brandLinkKindSchema>

export const brandItemSchema = z.strictObject({
  name: z.string().min(1),
  url: z.string().url().refine(u => u.startsWith('https://'), 'URL must use https://'),
  kind: brandLinkKindSchema,
  note: z.string().optional(),
})
export type BrandLink = z.infer<typeof brandItemSchema>

export const relatedMaterialSchema = z.strictObject({
  label: z.string().min(1),
  brands: z.array(brandItemSchema).min(1),
})
export type RelatedMaterial = z.infer<typeof relatedMaterialSchema>

export const brandLinkEntrySchema = z.strictObject({
  groupId: z.string().min(1),
  itemId: z.string().min(1).optional(),
  brands: z.array(brandItemSchema).min(1),
  relatedMaterials: z.array(relatedMaterialSchema).optional(),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date string required'),
}).superRefine((entry, ctx) => {
  const hosts = new Set<string>()
  for (const b of entry.brands) {
    try {
      const h = new URL(b.url).hostname.replace(/^www\./, '')
      if (hosts.has(h)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate hostname ${h} within entry ${entry.itemId ?? entry.groupId}` })
      }
      hosts.add(h)
    } catch {
      ctx.addIssue({ code: 'custom', message: `Invalid URL: ${b.url}` })
    }
  }
})
export type BrandLinkEntry = z.infer<typeof brandLinkEntrySchema>

export const noLinkNeededSchema = z.strictObject({
  itemId: z.string().min(1),
  reason: z.string().min(1),
})

export const brandAllowlistSchema = z.strictObject({
  schemaVersion: z.literal(1),
  domains: z.array(z.string().min(1)),
})

export const brandLinksRegistrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.array(brandLinkEntrySchema).min(1),
  noLinkNeeded: z.array(noLinkNeededSchema),
})

export const brandAllowlist = brandAllowlistSchema.parse(allowlistRaw)
export const brandLinksRegistry = brandLinksRegistrySchema.superRefine((reg, ctx) => {
  const allowed = new Set(brandAllowlist.domains)
  for (const entry of reg.entries) {
    for (const b of entry.brands) {
      const h = new URL(b.url).hostname
      if (!allowed.has(h)) {
        ctx.addIssue({ code: 'custom', message: `Domain ${h} is not in brand-allowlist.json` })
      }
    }
    if (entry.relatedMaterials) {
      for (const rm of entry.relatedMaterials) {
        for (const b of rm.brands) {
          const h = new URL(b.url).hostname
          if (!allowed.has(h)) {
            ctx.addIssue({ code: 'custom', message: `Related material domain ${h} is not in brand-allowlist.json` })
          }
        }
      }
    }
  }
}).parse(raw)

export const noLinkNeededMap = new Map(brandLinksRegistry.noLinkNeeded.map(n => [n.itemId, n.reason]))

export function isNoLinkNeeded(itemId: string): boolean {
  return noLinkNeededMap.has(itemId)
}

export function noLinkReason(itemId: string): string | undefined {
  return noLinkNeededMap.get(itemId)
}

/** Normalize item parameter to id and group */
function resolveItemContext(item: SpecItem | { id: string; group?: string } | string): { id: string; group: string; label: string } {
  if (typeof item === 'string') {
    const found = specsCatalogue.items.find(i => i.id === item)
    return { id: item, group: found?.group ?? item, label: found?.label ?? item }
  }
  const group = item.group ?? specsCatalogue.items.find(i => i.id === item.id)?.group ?? ''
  const label = 'label' in item && typeof item.label === 'string' ? item.label : specsCatalogue.items.find(i => i.id === item.id)?.label ?? item.id
  return { id: item.id, group, label }
}

export type BrandLinksResult = BrandLink[] & {
  relatedMaterials: RelatedMaterial[]
  hasProductSource?: boolean
  selectedBrandName?: string
}

/**
 * Priority order:
 * 1. Selected option's own sourceUrl in products.json (or flooring products) when sourceKind is "product" or "collection".
 * 2. Item-level entry (itemId).
 * 3. Group-level entry (groupId).
 * Dedupe by hostname.
 * Paint: selected paint brand first.
 * Flooring/wall tiles: selected tile brand first.
 */
export function getBrandLinks(
  item: SpecItem | { id: string; group?: string } | string,
  selectedOption?: SpecOption | { id: string; name?: string; finishProductId?: string; flooringProductId?: string } | null,
): BrandLinksResult {
  const { id: itemId, group: groupId } = resolveItemContext(item)
  if (isNoLinkNeeded(itemId)) {
    const empty: BrandLink[] = []
    return Object.assign(empty, { relatedMaterials: [] })
  }

  const candidateLinks: BrandLink[] = []
  let hasProductSource = false
  let selectedBrandName: string | undefined

  // 1. Option's own product/collection source URL
  if (selectedOption) {
    if (selectedOption.finishProductId) {
      const finish = finishProduct(selectedOption.finishProductId)
      if (finish) {
        selectedBrandName = finish.brand
        if (finish.sourceUrl && (finish.sourceKind === 'product' || finish.sourceKind === 'collection')) {
          hasProductSource = finish.sourceKind === 'product'
          candidateLinks.push({
            name: finish.brand,
            url: finish.sourceUrl,
            kind: finish.sourceKind === 'product' ? 'product-finder' : 'category-page',
            note: finish.sourceKind === 'product' ? 'Specific product' : 'Brand / collection reference',
          })
        }
      }
    } else if (selectedOption.flooringProductId) {
      const product = flooringProduct(selectedOption.flooringProductId)
      if (product) {
        selectedBrandName = product.manufacturer
        if (product.sourceUrl) {
          hasProductSource = true
          candidateLinks.push({
            name: product.manufacturer,
            url: product.sourceUrl,
            kind: 'product-finder',
            note: 'Specific product',
          })
        }
      }
    }
  }

  // 2. Item-level entry
  const itemEntry = brandLinksRegistry.entries.find(e => e.itemId === itemId)
  if (itemEntry) {
    candidateLinks.push(...itemEntry.brands)
  }

  // 3. Group-level entry
  const groupEntry = brandLinksRegistry.entries.find(e => e.groupId === groupId && !e.itemId)
  if (groupEntry) {
    candidateLinks.push(...groupEntry.brands)
  }

  // Dedupe by normalized hostname (e.g. asianpaints.com)
  const seenHosts = new Set<string>()
  let links: BrandLink[] = []
  for (const b of candidateLinks) {
    try {
      const parsed = new URL(b.url)
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
      if (!seenHosts.has(host)) {
        seenHosts.add(host)
        links.push(b)
      }
    } catch {
      // ignore malformed URLs
    }
  }

  // Brand reordering rules:
  // For paint, put the brand of the selected product first
  // For flooring/wall tiles, the selected tile brand first
  if (selectedBrandName) {
    const brandLower = selectedBrandName.toLowerCase()
    const matchIdx = links.findIndex(l => l.name.toLowerCase().includes(brandLower) || brandLower.includes(l.name.toLowerCase()))
    if (matchIdx > 0) {
      const [matched] = links.splice(matchIdx, 1)
      links.unshift(matched)
    }
  }

  // Collect related materials (item-level first, then group-level)
  const relatedList: RelatedMaterial[] = []
  const seenRelated = new Set<string>()
  const addRelated = (entries?: RelatedMaterial[]) => {
    if (!entries) return
    for (const rm of entries) {
      const key = rm.label.toLowerCase()
      if (!seenRelated.has(key)) {
        seenRelated.add(key)
        relatedList.push(rm)
      }
    }
  }
  addRelated(itemEntry?.relatedMaterials)
  addRelated(groupEntry?.relatedMaterials)

  return Object.assign(links, {
    relatedMaterials: relatedList,
    hasProductSource,
    selectedBrandName,
  })
}

export function getRelatedMaterials(item: SpecItem | { id: string; group?: string } | string): RelatedMaterial[] {
  const result = getBrandLinks(item)
  return result.relatedMaterials
}

export type BrandSearchResult = {
  groupId: string
  groupLabel: string
  itemId?: string
  itemLabel?: string
  brand: BrandLink
  matchedOn: 'brand' | 'item' | 'group' | 'related'
  relatedLabel?: string
}

/** Global search across all brand links and related materials */
export function searchBrandLinks(query: string): BrandSearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const results: BrandSearchResult[] = []
  const seen = new Set<string>()

  for (const entry of brandLinksRegistry.entries) {
    const group = specsCatalogue.groups.find(g => g.id === entry.groupId)
    const item = entry.itemId ? specsCatalogue.items.find(i => i.id === entry.itemId) : undefined
    const groupLabel = group?.label ?? entry.groupId
    const itemLabel = item?.label

    const groupMatch = entry.groupId.toLowerCase().includes(q) || groupLabel.toLowerCase().includes(q)
    const itemMatch = !!(entry.itemId?.toLowerCase().includes(q) || itemLabel?.toLowerCase().includes(q))

    // Check direct brands
    for (const b of entry.brands) {
      const brandMatch = b.name.toLowerCase().includes(q) || (b.note?.toLowerCase().includes(q) ?? false)
      if (brandMatch || itemMatch || groupMatch) {
        const key = `${entry.groupId}:${entry.itemId ?? ''}:${b.url}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push({
            groupId: entry.groupId,
            groupLabel,
            itemId: entry.itemId,
            itemLabel,
            brand: b,
            matchedOn: brandMatch ? 'brand' : itemMatch ? 'item' : 'group',
          })
        }
      }
    }

    // Check related materials
    if (entry.relatedMaterials) {
      for (const rm of entry.relatedMaterials) {
        const relMatch = rm.label.toLowerCase().includes(q)
        for (const b of rm.brands) {
          const brandMatch = b.name.toLowerCase().includes(q) || (b.note?.toLowerCase().includes(q) ?? false)
          if (relMatch || brandMatch || itemMatch || groupMatch) {
            const key = `rel:${entry.groupId}:${rm.label}:${b.url}`
            if (!seen.has(key)) {
              seen.add(key)
              results.push({
                groupId: entry.groupId,
                groupLabel,
                itemId: entry.itemId,
                itemLabel,
                brand: b,
                matchedOn: relMatch ? 'related' : brandMatch ? 'brand' : 'group',
                relatedLabel: rm.label,
              })
            }
          }
        }
      }
    }
  }

  return results
}

/** Unique reference brands across an entire estimate */
export function referenceBrandsForBoq(cost: CostEstimate): BrandLink[] {
  const links: BrandLink[] = []
  const seen = new Set<string>()

  const uniqueItemIds = [...new Set(cost.boq.map(l => l.item).filter(Boolean))]
  for (const itemId of uniqueItemIds) {
    const itemLinks = getBrandLinks(itemId)
    for (const b of itemLinks) {
      const host = new URL(b.url).hostname.toLowerCase().replace(/^www\./, '')
      if (!seen.has(host)) {
        seen.add(host)
        links.push(b)
      }
    }
  }

  return links
}
