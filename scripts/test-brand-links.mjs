import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  brandLinksRegistry,
  brandAllowlist,
  getBrandLinks,
  isNoLinkNeeded,
  noLinkReason,
  brandLinksRegistrySchema,
} from '../src/lib/finishes/brandLinks.ts'
import { specsCatalogue } from '../src/lib/cost/catalogue.ts'

const REQUIRED_ITEM_LEVEL_IDS = [
  'cement',
  'reinforcement',
  'wiring',
  'switches',
  'light-fittings',
  'fans',
  'distribution-board',
  'sanitary',
  'cp-fittings',
  'water-pipes',
  'water-heater',
  'main-door',
  'internal-door',
  'door-hardware',
  'windows',
  'glass',
  'interior-paint',
  'exterior-paint',
  'bath-waterproofing',
  'terrace-waterproofing',
  'bath-wall-tiles',
  'floor-bathrooms',
  'floor-living',
  'kitchen-cabinets',
  'kitchen-sink',
  'false-ceiling',
  'solar',
]

const REQUIRED_RELATED_MATERIALS = [
  'tile adhesive & grout',
  'conduit pipes',
  'led tube lights',
  'bathroom accessories',
  'exhaust fans',
]

test('1. Zod validity of every entry, https only, no duplicate hostname within one entry', () => {
  const raw = JSON.parse(fs.readFileSync('src/lib/finishes/brandLinks.json', 'utf8'))
  const parsed = brandLinksRegistrySchema.parse(raw)
  assert.ok(parsed.entries.length > 0, 'Entries must not be empty')

  for (const entry of parsed.entries) {
    const entryId = entry.itemId ?? entry.groupId
    const hosts = new Set()
    for (const b of entry.brands) {
      assert.ok(b.url.startsWith('https://'), `URL must start with https://: ${b.url} in ${entryId}`)
      const host = new URL(b.url).hostname.toLowerCase().replace(/^www\./, '')
      assert.ok(!hosts.has(host), `Duplicate hostname ${host} found in entry ${entryId}`)
      hosts.add(host)
    }

    if (entry.relatedMaterials) {
      for (const rm of entry.relatedMaterials) {
        assert.ok(rm.brands.length > 0, `Related material ${rm.label} must have at least one brand`)
        const relHosts = new Set()
        for (const b of rm.brands) {
          assert.ok(b.url.startsWith('https://'), `Related material URL must start with https://: ${b.url}`)
          const host = new URL(b.url).hostname.toLowerCase().replace(/^www\./, '')
          assert.ok(!relHosts.has(host), `Duplicate hostname ${host} found in related material ${rm.label}`)
          relHosts.add(host)
        }
      }
    }
  }
})

test('2. EVERY item id in specs-catalogue.json resolves to at least one link through getBrandLinks, OR appears in noLinkNeeded', () => {
  const missing = []

  for (const item of specsCatalogue.items) {
    if (isNoLinkNeeded(item.id)) {
      const reason = noLinkReason(item.id)
      assert.ok(reason && reason.trim().length > 0, `Item ${item.id} in noLinkNeeded must have a reason`)
      continue
    }

    const links = getBrandLinks(item)
    if (!links || links.length === 0) {
      missing.push(item.id)
    }
  }

  assert.deepEqual(
    missing,
    [],
    `The following items in specs-catalogue.json failed to resolve to at least one brand link: ${missing.join(', ')}`
  )
})

test('3. Specified critical materials must have item-level (not just group-level) links', () => {
  const entriesWithItem = new Set(
    brandLinksRegistry.entries.filter(e => e.itemId).map(e => e.itemId)
  )

  const missingItemLevel = REQUIRED_ITEM_LEVEL_IDS.filter(id => !entriesWithItem.has(id))
  assert.deepEqual(
    missingItemLevel,
    [],
    `The following items are missing required item-level entries: ${missingItemLevel.join(', ')}`
  )

  for (const id of REQUIRED_ITEM_LEVEL_IDS) {
    const item = specsCatalogue.items.find(i => i.id === id)
    assert.ok(item, `Required item ${id} must exist in specs-catalogue.json`)
    const links = getBrandLinks(item)
    assert.ok(links.length > 0, `Item-level entry for ${id} must resolve to at least one link`)
  }
})

test('4. Related-materials exist for required sub-materials', () => {
  const allRelatedLabels = []
  for (const entry of brandLinksRegistry.entries) {
    if (entry.relatedMaterials) {
      for (const rm of entry.relatedMaterials) {
        allRelatedLabels.push(rm.label.toLowerCase())
      }
    }
  }

  for (const req of REQUIRED_RELATED_MATERIALS) {
    const found = allRelatedLabels.some(label => label.includes(req) || req.includes(label))
    assert.ok(found, `Related material matching "${req}" must exist in the registry`)
  }
})

test('5. Hostnames belong to allowlist file of verified brand domains', () => {
  const allowed = new Set(brandAllowlist.domains)
  assert.ok(allowed.size > 0, 'Brand allowlist must not be empty')

  const unallowed = new Set()
  for (const entry of brandLinksRegistry.entries) {
    for (const b of entry.brands) {
      const host = new URL(b.url).hostname
      if (!allowed.has(host)) {
        unallowed.add(host)
      }
    }
    if (entry.relatedMaterials) {
      for (const rm of entry.relatedMaterials) {
        for (const b of rm.brands) {
          const host = new URL(b.url).hostname
          if (!allowed.has(host)) {
            unallowed.add(host)
          }
        }
      }
    }
  }

  assert.deepEqual(
    [...unallowed],
    [],
    `The following hostnames are not in the brand allowlist: ${[...unallowed].join(', ')}`
  )
})
