import test from 'node:test'
import assert from 'node:assert/strict'
import { deterministicPreParse } from '../server/research/deterministic-preparser.mjs'

const testTargetSteel = {
  targetId: 't_steel',
  rateId: 'boq-steel',
  itemLabel: 'TMT Reinforcement Steel',
  trade: 'Civil & structure',
  requiredUnit: 'kg',
  specSummary: 'Fe 550D primary TMT rebars',
  queryTerm: 'Tata Tiscon 550D TMT steel price Pune',
}

const testTargetConcrete = {
  targetId: 't_conc',
  rateId: 'boq-concrete-m20',
  itemLabel: 'M20 Concrete Ready Mix',
  trade: 'Civil & structure',
  requiredUnit: 'm³',
  specSummary: 'M20 grade RMC ready mix concrete',
  queryTerm: 'M20 ready mix concrete price Pune',
}

const testTargetTiles = {
  targetId: 't_floor',
  rateId: 'floor-living-vitrified',
  itemLabel: 'Vitrified Floor Tiles',
  trade: 'Flooring & tiling',
  requiredUnit: 'm²',
  specSummary: '600x1200 mm glazed vitrified floor tiles',
  queryTerm: 'Kajaria glazed vitrified floor tiles price Pune',
}

test('Deterministic PreParser: Correctly extracts standard price, currency, and unit', () => {
  const doc = {
    docId: 'doc_steel',
    url: 'https://steeldepot.example.in/tata-tiscon',
    publisher: 'Maharashtra Steel Corp',
    textSample: 'Tata Tiscon 550D primary TMT steel bars current price in Pune is Rs 68.50 per kg excluding 18% GST.',
  }

  const result = deterministicPreParse(testTargetSteel, doc)
  assert.ok(result, 'Must extract evidence')
  assert.equal(result.quotedPrice, 68.5)
  assert.equal(result.quotedCurrency, 'INR')
  assert.equal(result.quotedUnit, 'kg')
  assert.equal(result.pricingBasis, 'supply-only')
  assert.equal(result.taxIncluded, false)
  assert.ok(doc.textSample.includes(result.excerpt), 'Excerpt must be authentic verbatim substring')
})

test('Deterministic PreParser: Accurately identifies turnkey installed basis', () => {
  const doc = {
    docId: 'doc_ceiling',
    url: 'https://ceilings.example.in/rates',
    publisher: 'Ceiling Master',
    textSample: 'Saint Gobain Gyproc false ceiling turnkey installed price is Rs 115 per sq ft including GI channels and finishing.',
  }

  const target = {
    targetId: 't_ceil',
    rateId: 'boq-false-ceiling',
    itemLabel: 'Gypsum Board False Ceiling',
    trade: 'Finishes & painting',
    requiredUnit: 'm²',
    specSummary: 'Gypsum board false ceiling',
  }

  const result = deterministicPreParse(target, doc)
  assert.ok(result)
  assert.equal(result.quotedPrice, 115)
  assert.equal(result.quotedUnit, 'sqft')
  assert.equal(result.pricingBasis, 'installed')
  assert.ok(result.confidenceReasoning.includes('installed'))
})

test('Deterministic PreParser: Accurately identifies labour-only basis', () => {
  const doc = {
    docId: 'doc_labour',
    url: 'https://contractors.example.in/tile-fixing',
    publisher: 'Pune Contractors',
    textSample: 'Vitrified floor tile laying labour charges is Rs 24 per sq ft in Pune for residential floors. Material supplied by owner.',
  }

  const target = {
    targetId: 't_tile_lab',
    rateId: 'boq-tile-labour',
    itemLabel: 'Tile Laying Labour',
    trade: 'Flooring & tiling',
    requiredUnit: 'm²',
    specSummary: 'Vitrified tile laying labour charges',
  }

  const result = deterministicPreParse(target, doc)
  assert.ok(result)
  assert.equal(result.quotedPrice, 24)
  assert.equal(result.quotedUnit, 'sqft')
  assert.equal(result.pricingBasis, 'labour-only')
})

test('Deterministic PreParser: Handles pack sizes and tile boxes', () => {
  const doc = {
    docId: 'doc_tile_box',
    url: 'https://tiles.example.in/somany',
    publisher: 'Somany Showroom',
    textSample: 'Somany Duragres vitrified tiles price is Rs 720 per box covering 15.5 sq ft in Pune showroom.',
  }

  const result = deterministicPreParse(testTargetTiles, doc)
  assert.ok(result)
  assert.equal(result.quotedPrice, 720)
  assert.equal(result.quotedUnit, 'box')
  assert.equal(result.packSize, 15.5)
})

test('Deterministic PreParser: Rejects unrelated trade lines', () => {
  const doc = {
    docId: 'doc_unrelated',
    url: 'https://allsupplies.example.in/catalogue',
    publisher: 'Mega Supplies',
    textSample: 'Supreme PVC 110 mm drainage pipe rate is Rs 240 per meter ex-godown.',
  }

  // Target is Concrete, but snippet mentions PVC drainage pipe
  const result = deterministicPreParse(testTargetConcrete, doc)
  assert.equal(result, null, 'Must ignore unrelated trade snippet')
})

test('Deterministic PreParser: Returns null for non-price content', () => {
  const doc = {
    docId: 'doc_faq',
    url: 'https://rmc-plant.example.in/about',
    publisher: 'RMC Plant',
    textSample: 'Contact our sales engineers for customized mix design testing and site inspection schedules in Pune.',
  }

  const result = deterministicPreParse(testTargetConcrete, doc)
  assert.equal(result, null, 'Must return null when no price is quoted')
})
