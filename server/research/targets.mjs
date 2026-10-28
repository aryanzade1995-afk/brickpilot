import { resolveSpecification } from '../../src/lib/cost/catalogue.ts'
import { classifyTradeScope, isLineInScope } from '../../src/lib/cost/pricingContext.ts'

/**
 * Deterministically constructs bounded research targets from actual design requirements
 * and selected project location. Never includes private client data or geometry.
 */
export function buildResearchTargets(design, brief, location, scopeMode = 'combined', maxTargets = 10) {
  const city = (location?.city || 'Pune').trim()
  const targets = []
  const seenRates = new Set()

  const addTarget = (rateId, itemId, itemLabel, trade, queryTerm, requiredUnit, basisRequired, specSummary, brandOrGrade) => {
    if (seenRates.has(rateId)) return
    if (!isLineInScope(trade, itemId, scopeMode)) return
    seenRates.add(rateId)

    targets.push({
      targetId: `target_${rateId}`,
      rateId,
      itemId,
      itemLabel,
      trade,
      scope: classifyTradeScope(trade, itemId),
      queryTerm: `${queryTerm} ${city}`.trim(),
      requiredUnit,
      basisRequired,
      specSummary,
      brandOrGrade,
    })
  }

  // 1. Civil & Structure - Concrete (Primary structural driver)
  try {
    const concSpec = resolveSpecification(brief, 'concrete-grade')
    if (concSpec?.rateId) {
      addTarget(
        concSpec.rateId,
        'concrete-grade',
        `Ready-mix concrete: ${concSpec.name}`,
        'Civil & structure',
        `Ready mix concrete RMC ${concSpec.name} grade price per m3`,
        'm³',
        'supply-only',
        concSpec.name,
        concSpec.name,
      )
    }
  } catch {}

  // 2. Civil & Structure - Reinforcement Steel
  try {
    const steelSpec = resolveSpecification(brief, 'reinforcement')
    if (steelSpec?.rateId) {
      addTarget(
        steelSpec.rateId,
        'reinforcement',
        `Reinforcement Steel: ${steelSpec.name}`,
        'Civil & structure',
        `${steelSpec.name} primary TMT steel bar price per kg tonne`,
        'kg',
        'supply-only',
        steelSpec.name,
        steelSpec.name,
      )
    }
  } catch {}

  // 3. Masonry & Plaster
  try {
    const masonSpec = resolveSpecification(brief, 'masonry-type')
    if (masonSpec?.rateId) {
      addTarget(
        masonSpec.rateId,
        'masonry-type',
        `Masonry: ${masonSpec.name}`,
        'Civil & structure',
        `${masonSpec.name} bricks price per piece thousand`,
        'm³',
        'supply-only',
        masonSpec.name,
        masonSpec.name,
      )
    }
  } catch {}

  // 4. Flooring & Tiling (Resolved from brief)
  try {
    const floorSpec = resolveSpecification(brief, 'floor-living')
    if (floorSpec?.rateId) {
      addTarget(
        floorSpec.rateId,
        'floor-living',
        `Flooring: ${floorSpec.name}`,
        'Flooring & tiling',
        `${floorSpec.name} floor tiles price per sqft m2`,
        'm²',
        'supply-only',
        floorSpec.facts?.[0] || 'Vitrified glazed tiles',
        floorSpec.name,
      )
    }
  } catch {}

  // 5. Interior Wall Painting (Resolved from brief)
  try {
    const paintSpec = resolveSpecification(brief, 'interior-paint')
    if (paintSpec?.rateId) {
      addTarget(
        paintSpec.rateId,
        'interior-paint',
        `Interior paint: ${paintSpec.name}`,
        'Painting',
        `${paintSpec.name} interior wall paint 20 litre price`,
        'm²',
        'supply-only',
        paintSpec.name,
        paintSpec.name,
      )
    }
  } catch {}

  // 6. Plumbing - Overhead Water Storage
  addTarget(
    'boq-tank-overhead-plastic',
    'water-tanks',
    'Overhead plastic water tank (1,000 L)',
    'Plumbing & sanitary',
    'Sintex triple layer 1000 litre overhead water tank price',
    'item',
    'supply-only',
    '1,000 L food grade triple layer plastic water storage tank',
    '1000 L',
  )

  // 7. Plumbing - Water Supply Pipes (25 mm CPVC)
  addTarget(
    'boq-pipe-water-cpvc-25mm',
    'water-pipes',
    'CPVC Water pipe 25 mm (1 inch)',
    'Plumbing & sanitary',
    'Astral Supreme CPVC 25mm SDR 11 pipe price per metre',
    'm',
    'supply-only',
    '25 mm nominal diameter CPVC water supply pipe',
    '25 mm CPVC',
  )

  // 8. Doors & Windows
  try {
    const doorSpec = resolveSpecification(brief, 'internal-door')
    if (doorSpec?.rateId) {
      addTarget(
        doorSpec.rateId,
        'internal-door',
        `Internal doors: ${doorSpec.name}`,
        'Doors & windows',
        `${doorSpec.name} wooden flush door shutter price`,
        'm²',
        'supply-only',
        doorSpec.name,
        doorSpec.name,
      )
    }
  } catch {}

  // 9. Windows
  try {
    const winSpec = resolveSpecification(brief, 'windows')
    if (winSpec?.rateId) {
      addTarget(
        winSpec.rateId,
        'windows',
        `Windows: ${winSpec.name}`,
        'Doors & windows',
        `${winSpec.name} window price per sqft m2`,
        'm²',
        'supply-only',
        winSpec.name,
        winSpec.name,
      )
    }
  } catch {}

  // 10. Waterproofing
  addTarget(
    'boq-waterproofing-terrace',
    'terrace-waterproofing',
    'Terrace brickbat coba waterproofing',
    'Waterproofing',
    'Terrace brickbat coba waterproofing rate per sqft m2',
    'm²',
    'installed',
    'Brickbat coba waterproofing with cement slurry and IPS finish',
    'Brickbat coba',
  )

  return targets.slice(0, maxTargets)
}
