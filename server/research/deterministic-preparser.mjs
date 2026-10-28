/**
 * Deterministic Price Pre-Parser for Indian Construction & Interior Quotations.
 * Bypasses LLM overhead for standard price formats and extracts structured
 * quotation data with zero inference cost and sub-millisecond latency.
 */

// Common Indian construction unit aliases and standard forms
const UNIT_PATTERNS = [
  // Area units
  { pattern: /(?:per|\/)\s*(?:sq\.?\s*ft\.?|sqft|sft|square\s+feet|square\s+foot)\b/i, unit: 'sqft', kind: 'area' },
  { pattern: /(?:per|\/)\s*(?:m²|m2|sqm|sq\.?\s*m\.?|square\s+met(?:re|er))\b/i, unit: 'm²', kind: 'area' },
  { pattern: /(?:per|\/)\s*(?:box|carton)\b/i, unit: 'box', kind: 'area' },
  { pattern: /(?:per|\/)\s*(?:bucket|tin)\b/i, unit: 'bucket', kind: 'area' },
  // Weight units
  { pattern: /(?:per|\/)\s*(?:kg|kilogram|kilo)\b/i, unit: 'kg', kind: 'weight' },
  { pattern: /(?:per|\/)\s*(?:metric\s+tonne|tonne|ton|mt)\b/i, unit: 'metric tonne', kind: 'weight' },
  { pattern: /(?:per|\/)\s*(?:quintal|q)\b/i, unit: 'quintal', kind: 'weight' },
  // Volume units
  { pattern: /(?:per|\/)\s*(?:m³|m3|cum|cubic\s+met(?:re|er))\b/i, unit: 'm³', kind: 'volume' },
  { pattern: /(?:per|\/)\s*(?:cft|cu\.?\s*ft\.?|cubic\s+feet)\b/i, unit: 'cft', kind: 'volume' },
  // Length units
  { pattern: /(?:per|\/)\s*(?:rft|running\s+feet|running\s+foot)\b/i, unit: 'ft', kind: 'length' },
  { pattern: /(?:per|\/)\s*(?:running\s+met(?:re|er)|rmt|met(?:re|er)|m)\b/i, unit: 'm', kind: 'length' },
  // Item / piece units
  { pattern: /(?:per|\/)\s*(?:piece|pc|unit|item|no\.?|nos\.?)\b/i, unit: 'item', kind: 'item' },
  { pattern: /(?:per|\/)\s*(?:point|pt)\b/i, unit: 'point', kind: 'item' },
  { pattern: /(?:per|\/)\s*(?:50\s*kg\s*bag|bag)\b/i, unit: 'bag', kind: 'item' },
  { pattern: /(?:per|\/)\s*(?:1000\s*(?:nos|pcs|bricks|blocks)|thousand)\b/i, unit: '1000 items', kind: 'item' },
]

/**
 * Extracts a numeric price from currency text, supporting comma-separated numbers (4,250),
 * Indian lakhs/crores (2.5 lakh), and standard decimals (68.50).
 */
function parseIndianPrice(rawStr) {
  if (!rawStr) return null
  const cleaned = rawStr.replace(/[₹,\s]/g, '').trim()

  // Check for lakh: e.g. "2.5 lakh"
  const lakhMatch = rawStr.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac)s?/i)
  if (lakhMatch) {
    const val = parseFloat(lakhMatch[1])
    return Number.isFinite(val) ? val * 100000 : null
  }

  // Check for crore: e.g. "1.2 crore"
  const croreMatch = rawStr.match(/(\d+(?:\.\d+)?)\s*crore?s?/i)
  if (croreMatch) {
    const val = parseFloat(croreMatch[1])
    return Number.isFinite(val) ? val * 10000000 : null
  }

  // Direct number
  const numMatch = cleaned.match(/^(\d+(?:\.\d+)?)/)
  if (numMatch) {
    const val = parseFloat(numMatch[1])
    return Number.isFinite(val) && val > 0 ? val : null
  }

  return null
}

/**
 * Determines whether the candidate line matches the target trade/item.
 */
function isRelevantToTarget(text, target) {
  const lower = text.toLowerCase()
  const targetLabel = (target.itemLabel || '').toLowerCase()
  const specSummary = (target.specSummary || '').toLowerCase()
  const queryTerm = (target.queryTerm || '').toLowerCase()
  const trade = (target.trade || '').toLowerCase()

  // Tokenize keywords (min length 3)
  const keywords = [
    ...targetLabel.split(/\s+/),
    ...specSummary.split(/\s+/),
    ...queryTerm.split(/\s+/),
  ].map(k => k.replace(/[^a-z0-9]/g, '')).filter(k => k.length >= 3)

  // Specific high-value keyword mappings by rateId/trade
  const specificTerms = {
    concrete: ['concrete', 'rmc', 'ready-mix', 'readymix', 'm20', 'm25', 'm30', 'cement concrete'],
    steel: ['steel', 'tmt', 'rebar', 'reinforcement', 'tiscon', 'fe500', 'fe550', 'sail', 'jsw'],
    floor: ['tile', 'vitrified', 'gvt', 'ceramic', 'flooring', 'granite', 'marble', 'kajaria', 'somany'],
    paint: ['paint', 'emulsion', 'royale', 'distemper', 'primer', 'asian paints', 'berger', 'dulux', 'tractor'],
    brick: ['brick', 'block', 'aac', 'flyash', 'fly ash', 'clay brick', 'masonry'],
    pipe: ['pipe', 'cpvc', 'upvc', 'pvc', 'astral', 'finolex', 'ashirvad', 'plumbing'],
    tank: ['tank', 'water tank', 'sintex', 'storage tank', 'overhead'],
    ceiling: ['ceiling', 'false ceiling', 'gypsum', 'grid ceiling', 'pop'],
    door: ['door', 'flush door', 'shutter', 'frame', 'veneer', 'laminate'],
    joinery: ['wardrobe', 'cabinet', 'kitchen', 'modular', 'plywood', 'carcass', 'drawer'],
  }

  let matchesCategory = false
  for (const [cat, terms] of Object.entries(specificTerms)) {
    if (target.rateId?.includes(cat) || targetLabel.includes(cat) || trade.includes(cat)) {
      if (terms.some(t => lower.includes(t))) {
        matchesCategory = true
        break
      }
    }
  }

  // Check matching token count
  const matchingTokens = keywords.filter(k => lower.includes(k))
  const tokenMatchRatio = keywords.length > 0 ? matchingTokens.length / keywords.length : 0

  return matchesCategory || tokenMatchRatio >= 0.25 || matchingTokens.length >= 2
}

/**
 * Extracts publication date if mentioned in the snippet or text.
 */
function extractDate(text) {
  // ISO date format (YYYY-MM-DD)
  const isoMatch = text.match(/\b(202[4-9]-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/)
  if (isoMatch) return isoMatch[1]

  // Month Year format: e.g. "October 2026", "Oct 2026"
  const monthNames = {
    january: '01', feb: '02', february: '02', mar: '03', march: '03', apr: '04', april: '04',
    may: '05', jun: '06', june: '06', jul: '07', july: '07', aug: '08', august: '08',
    sep: '09', september: '09', oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12'
  }
  const monthMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+(202[4-9])\b/i)
  if (monthMatch) {
    const month = monthNames[monthMatch[1].toLowerCase()]
    const year = monthMatch[2]
    if (month && year) return `${year}-${month}-01`
  }

  return null
}

/**
 * Deterministically attempts to parse price evidence from raw document text.
 * Returns an ExtractedEvidence-compatible object if high confidence, or null if ambiguous.
 */
export function deterministicPreParse(target, doc) {
  if (!doc?.textSample || typeof doc.textSample !== 'string') return null

  const textSample = doc.textSample
  const lines = textSample.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 10)

  // Price pattern: ₹, Rs, Rs., INR followed by price or price followed by unit
  // Examples: "Rs 4,250 per cubic metre", "₹68.50/kg", "Rs. 961 per box", "Price: Rs 62 per sq ft"
  const priceRegex = /(?:(?:₹|Rs\.?|INR)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|\d+(?:\.\d+)?(?:\s*(?:lakh|lac|crore)s?)?)|([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|\d+(?:\.\d+)?)\s*(?:₹|Rs\.?|INR))\b/i

  // Candidate evaluation across sentences and lines
  const sentences = textSample
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 15)

  for (const sentence of sentences) {
    const priceMatch = sentence.match(priceRegex)
    if (!priceMatch) continue

    const rawPriceStr = priceMatch[1] || priceMatch[2]
    const price = parseIndianPrice(rawPriceStr)
    if (!price || price <= 0) continue

    // Find matching unit in this sentence
    let matchedUnit = null
    for (const u of UNIT_PATTERNS) {
      if (u.pattern.test(sentence)) {
        matchedUnit = u.unit
        break
      }
    }

    if (!matchedUnit) continue

    // Check relevance to target specification
    if (!isRelevantToTarget(sentence, target) && !isRelevantToTarget(doc.title || '', target)) {
      continue
    }

    // Determine pricing basis
    let pricingBasis = 'supply-only'
    if (/\b(?:installed|turnkey|with\s+installation|supply\s*(&|and)\s*(?:fix|install)|fixing\s+included|installation\s+included)\b/i.test(sentence)) {
      pricingBasis = 'installed'
    } else if (/\b(?:labour\s+only|labor\s+only|(?:laying|fixing|application)\s*(?:labour\s*)?charges?|labour\s+charges?|installation\s+only)\b/i.test(sentence)) {
      pricingBasis = 'labour-only'
    }

    // Determine tax inclusion
    let taxIncluded = 'unknown'
    if (/\b(?:inclusive\s+of\s+gst|incl\.?\s*gst|including\s+gst|with\s+18%\s*gst|tax\s+included|inclusive\s+of\s+taxes)\b/i.test(sentence)) {
      taxIncluded = true
    } else if (/\b(?:excl\.?\s*(?:\d+%\s*)?gst|excluding\s+(?:\d+%\s*)?gst|\+\s*\d+%\s*gst|taxes\s+extra|gst\s+extra|plus\s+gst)\b/i.test(sentence)) {
      taxIncluded = false
    }

    // Determine delivery inclusion
    let deliveryIncluded = 'unknown'
    if (/\b(?:free\s+delivery|delivery\s+included|inclusive\s+of\s+(?:transit\s+mixer\s+)?delivery|freight\s+included)\b/i.test(sentence)) {
      deliveryIncluded = true
    } else if (/\b(?:delivery\s+extra|transport\s+extra|freight\s+extra|cartage\s+extra)\b/i.test(sentence)) {
      deliveryIncluded = false
    }

    // Extract pack size if applicable
    let packSize = null
    const boxSqftMatch = sentence.match(/covering\s*(\d+(?:\.\d+)?)\s*(?:sq\s*ft|sqft|sft|m2|m²)/i)
    if (boxSqftMatch) {
      packSize = parseFloat(boxSqftMatch[1])
    } else {
      const litreMatch = sentence.match(/(\d+(?:\.\d+)?)\s*(?:litre|liter|l)\b/i)
      if (litreMatch) packSize = parseFloat(litreMatch[1])
    }

    // Find exact verbatim substring for excerpt verification
    const verbatimExcerpt = sentence.trim()

    // Extract publication date or fallback to null
    const publishedDate = extractDate(sentence) || extractDate(textSample)

    // Extract location mentioned if present
    const locMatch = sentence.match(/\b(?:in|at|for|across)\s+([A-Z][a-zA-Z\s]{2,20})\b/)
    const locationMentioned = locMatch ? locMatch[1].trim() : null

    return {
      evidenceId: `ev_${target.rateId}_${doc.docId || 'doc'}_preparse`,
      targetId: target.targetId,
      rateId: target.rateId,
      docId: doc.docId || 'doc',
      url: doc.url,
      publisher: doc.publisher || 'Supplier',
      publishedDate,
      fetchTimestamp: doc.fetchTimestamp || new Date().toISOString(),
      quotedPrice: price,
      quotedCurrency: 'INR',
      quotedUnit: matchedUnit,
      packSize: Number.isFinite(packSize) ? packSize : null,
      pricingBasis,
      taxIncluded,
      deliveryIncluded,
      minOrder: null,
      locationMentioned,
      excerpt: verbatimExcerpt,
      confidenceReasoning: `Deterministically extracted verbatim quotation: Rs ${price}/${matchedUnit} (${pricingBasis})`,
      specificationMatch: `Deterministic match for ${target.itemLabel} (${matchedUnit})`,
      method: 'deterministic',
    }
  }

  return null
}
