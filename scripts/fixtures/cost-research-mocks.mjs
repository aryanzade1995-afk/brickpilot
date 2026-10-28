/**
 * Test-Only Fixtures for Cost Research.
 * MOVED OUT OF PRODUCTION CODE.
 * Production server and client bundles must never import this file.
 */

export const MOCK_PAGES = {
  'concrete': {
    title: 'Ready Mix Concrete M20 Price in Pune - Ultratech RMC Supplier',
    url: 'https://rmcpune.example.in/products/m20-grade',
    publisher: 'Pune RMC Concrete Suppliers',
    text: 'UltraTech M20 grade ready-mix concrete price in Pune is Rs 4,250 per cubic metre (m3) inclusive of transit mixer delivery within 15 km. Pumping charges extra if required. Published October 2026 for Pune construction projects.',
  },
  'steel': {
    title: 'Tata Tiscon 550D TMT Steel Rebars Price List Pune',
    url: 'https://steeldepot.example.in/tata-tiscon-pune',
    publisher: 'Maharashtra Steel Distributors',
    text: 'Tata Tiscon 550D primary TMT steel bars current price in Pune is Rs 68.50 per kg (Rs 68,500 per metric tonne) excluding 18% GST. Delivery available across Pune and PCMC. Quotation valid for October 2026.',
  },
  'tiles': {
    title: 'Kajaria 600x1200 mm Glazed Vitrified Tiles Price Pune Showroom',
    url: 'https://tileshop.example.in/kajaria-gvt-120x60',
    publisher: 'Kajaria Tile Gallery Pune',
    text: 'Kajaria 600x1200 mm (2x4 ft) premium glazed vitrified floor tiles price is Rs 62 per sq ft (Rs 667 per m2) in Pune. Each box contains 2 tiles covering 15.5 sq ft (1.44 sq m) priced at Rs 961 per box. Supply only basis.',
  },
  'paint': {
    title: 'Asian Paints Royale Luxury Emulsion Paint 20L Bucket Price Pune',
    url: 'https://paintmart.example.in/asian-paints-royale-pune',
    publisher: 'Asian Paints Dealer Pune',
    text: 'Asian Paints Royale Luxury Emulsion interior paint 20 Litre bucket price is Rs 8,800 in Pune. Coverage approximately 140-160 sq ft per litre for 2 coats. Material cost equals approximately Rs 30 per sq ft (Rs 322 per m2) for two coats.',
  },
  'tank': {
    title: 'Sintex 1000 Litre Overhead Triple Layer Water Tank Price Pune',
    url: 'https://plumbingsupply.example.in/sintex-1000l-tank',
    publisher: 'Sintex Distributor Pune',
    text: 'Sintex 1000 Litre triple layer anti-bacterial overhead plastic water storage tank price in Pune is Rs 7,200 per unit. Installation and plumbing fittings charged separately.',
  },
  'pipe': {
    title: 'Astral CPVC Pro Pipes 25mm (1 inch) SDR 11 Price List',
    url: 'https://astraldealer.example.in/cpvc-25mm-pune',
    publisher: 'Astral Pipes Pune',
    text: 'Astral CPVC Pro 25 mm Class 1 (SDR 11) water supply pipe price is Rs 115 per metre in Pune. Tough, leak-proof and NSF certified for potable hot and cold residential water lines.',
  },
}

export function mockExtract(target, doc) {
  const text = (doc.textSample || '').toLowerCase()
  const today = '2026-10-24'

  if (target.rateId?.includes('concrete') && text.includes('4,250')) {
    return {
      evidenceId: `ev_${target.rateId}_${doc.docId || 'doc1'}`,
      targetId: target.targetId,
      rateId: target.rateId,
      docId: doc.docId || 'doc1',
      url: doc.url,
      publisher: doc.publisher,
      publishedDate: today,
      fetchTimestamp: doc.fetchTimestamp || new Date().toISOString(),
      quotedPrice: 4250,
      quotedCurrency: 'INR',
      quotedUnit: 'm3',
      packSize: null,
      pricingBasis: 'supply-only',
      taxIncluded: 'unknown',
      deliveryIncluded: true,
      minOrder: 'Transit mixer load',
      locationMentioned: 'Pune',
      excerpt: 'UltraTech M20 grade ready-mix concrete price in Pune is Rs 4,250 per cubic metre (m3) inclusive of transit mixer delivery within 15 km.',
      confidenceReasoning: 'Matches M20 RMC per cubic metre for Pune region.',
      specificationMatch: 'Exact M20 RMC ready mix grade.',
    }
  }

  if ((target.rateId?.includes('steel') || target.rateId?.includes('reinforcement')) && (text.includes('68.50') || text.includes('68500'))) {
    return {
      evidenceId: `ev_${target.rateId}_${doc.docId || 'doc1'}`,
      targetId: target.targetId,
      rateId: target.rateId,
      docId: doc.docId || 'doc1',
      url: doc.url,
      publisher: doc.publisher,
      publishedDate: today,
      fetchTimestamp: doc.fetchTimestamp || new Date().toISOString(),
      quotedPrice: 68.5,
      quotedCurrency: 'INR',
      quotedUnit: 'kg',
      packSize: null,
      pricingBasis: 'supply-only',
      taxIncluded: false,
      deliveryIncluded: 'unknown',
      minOrder: '1 MT',
      locationMentioned: 'Pune and PCMC',
      excerpt: 'Tata Tiscon 550D primary TMT steel bars current price in Pune is Rs 68.50 per kg (Rs 68,500 per metric tonne) excluding 18% GST.',
      confidenceReasoning: 'Direct price per kg for Fe 550D TMT rebars.',
      specificationMatch: 'Tata Tiscon Fe550D primary TMT rebars.',
    }
  }

  return null
}
