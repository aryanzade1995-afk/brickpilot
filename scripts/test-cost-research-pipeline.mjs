import test from 'node:test'
import assert from 'node:assert/strict'
import { SearchAdapter, cleanHtml } from '../server/research/search-adapter.mjs'
import { OllamaExtractor } from '../server/research/ollama-extractor.mjs'
import { handleCostResearchRequest } from '../server/cost-research.mjs'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { mockExtract } from './fixtures/cost-research-mocks.mjs'

test('SearchAdapter blocks SSRF and private IP ranges', async () => {
  const adapter = new SearchAdapter()

  // 1. localhost & 127.0.0.1
  await assert.rejects(
    async () => adapter.fetchPage('http://localhost:8080/secret'),
    /SSRF blocked/,
  )
  await assert.rejects(
    async () => adapter.fetchPage('http://127.0.0.1:11434/api/tags'),
    /SSRF blocked/,
  )

  // 2. Cloud metadata service (169.254.169.254 / metadata.google.internal)
  await assert.rejects(
    async () => adapter.fetchPage('http://169.254.169.254/computeMetadata/v1/'),
    /SSRF blocked/,
  )
  await assert.rejects(
    async () => adapter.fetchPage('http://metadata.google.internal/computeMetadata/v1/'),
    /SSRF blocked/,
  )

  // 3. Private RFC 1918 subnets (10.x.x.x, 192.168.x.x)
  await assert.rejects(
    async () => adapter.fetchPage('http://10.0.0.1/admin'),
    /SSRF blocked/,
  )
  await assert.rejects(
    async () => adapter.fetchPage('http://192.168.1.1/router'),
    /SSRF blocked/,
  )

  // 4. Non-http protocols
  await assert.rejects(
    async () => adapter.fetchPage('file:///etc/passwd'),
    /Rejected unsafe protocol/,
  )
})

test('cleanHtml strips scripts, styles, tags and normalizes whitespace', () => {
  const raw = `
    <html>
      <head><style>body { color: red; }</style></head>
      <body>
        <script>alert("hack")</script>
        <h1>UltraTech Concrete M20</h1>
        <p>Price: Rs &nbsp; 4,250 per m3 &amp; delivery included.</p>
      </body>
    </html>
  `
  const cleaned = cleanHtml(raw)
  assert.equal(cleaned.includes('alert'), false)
  assert.equal(cleaned.includes('color: red'), false)
  assert.equal(cleaned.includes('<h1>'), false)
  assert.ok(cleaned.includes('UltraTech Concrete M20 Price: Rs 4,250 per m3 & delivery included.'))
})

test('OllamaExtractor extracts price using test fixtures in test mode', async () => {
  const extractor = new OllamaExtractor({ mock: true }, { mockExtract })
  const target = {
    targetId: 't_steel',
    rateId: 'boq-steel',
    itemLabel: 'TMT Steel Fe500D',
    trade: 'Civil & structure',
    requiredUnit: 'kg',
    specSummary: 'Fe 500D primary TMT rebars',
  }
  const doc = {
    docId: 'doc_steel_1',
    url: 'https://steeldepot.example.in/tata-tiscon-pune',
    publisher: 'Maharashtra Steel Distributors',
    fetchTimestamp: new Date().toISOString(),
    textSample: 'Tata Tiscon 550D primary TMT steel bars current price in Pune is Rs 68.50 per kg (Rs 68,500 per metric tonne) excluding 18% GST.',
  }

  const extracted = await extractor.extractPriceEvidence(target, doc)
  assert.ok(extracted)
  assert.equal(extracted.quotedPrice, 68.5)
  assert.equal(extracted.quotedUnit, 'kg')
  assert.equal(extracted.pricingBasis, 'supply-only')
  assert.ok(doc.textSample.includes(extracted.excerpt))
})

test('handleCostResearchRequest handles GET /api/cost-research/health with truthful probe', async () => {
  let status = 0
  let body = null
  const mockRes = {
    writeHead(s, headers) {
      status = s
    },
    end(data) {
      body = JSON.parse(data)
    },
  }
  const mockReq = { method: 'GET', url: '/api/cost-research/health', headers: {} }

  const handled = await handleCostResearchRequest(mockReq, mockRes, async () => ({}))
  assert.equal(handled, true)
  assert.equal(status, 200)
  assert.ok(body.ollama)
  assert.equal(typeof body.ollama.reachable, 'boolean')
  // Ollama is not running in test; enabled must be false and status degraded
  assert.equal(body.enabled, false)
  assert.equal(body.status, 'degraded')
})

test('handleCostResearchRequest validates design snapshot and starts background research job', async () => {
  const brief = defaultBrief()
  const model = compile(brief)
  const design = generate(model)

  let status = 0
  let body = null
  const mockRes = {
    writeHead(s) {
      status = s
    },
    end(data) {
      body = JSON.parse(data)
    },
  }

  // 1. POST invalid snapshot (failing hard checks)
  const invalidDesign = structuredClone(design)
  // Force hard error by setting room to negative size
  if (invalidDesign.floors[0]?.rooms[0]?.rect) {
    invalidDesign.floors[0].rooms[0].rect.w = -100
  }

  const mockInvalidReq = { method: 'POST', url: '/api/cost-research', headers: {} }
  const readInvalidJson = async () => ({
    design: invalidDesign,
    brief,
    location: { city: 'Pune' },
  })

  await handleCostResearchRequest(mockInvalidReq, mockRes, readInvalidJson)
  assert.equal(status, 400)
  assert.ok(body.error.includes('validation checks'))

  // 2. POST valid snapshot
  const mockValidReq = { method: 'POST', url: '/api/cost-research', headers: {} }
  const readValidJson = async () => ({
    design,
    brief,
    location: { city: 'Pune', country: 'IN', currency: 'INR' },
    scopeMode: 'combined',
  })

  await handleCostResearchRequest(mockValidReq, mockRes, readValidJson)
  assert.equal(status, 202)
  assert.ok(body.jobId)
  assert.equal(body.status, 'queued')
  assert.ok(body.sourceFingerprint)

  const jobId = body.jobId

  // 3. GET /api/cost-research/:jobId
  const mockGetReq = { method: 'GET', url: `/api/cost-research/${jobId}`, headers: {} }
  await handleCostResearchRequest(mockGetReq, mockRes, async () => ({}))
  assert.equal(status, 200)
  assert.equal(body.jobId, jobId)

  // 4. POST /api/cost-research/:jobId/cancel
  const mockCancelReq = { method: 'POST', url: `/api/cost-research/${jobId}/cancel`, headers: {} }
  await handleCostResearchRequest(mockCancelReq, mockRes, async () => ({}))
  assert.equal(status, 200)
  assert.equal(body.status, 'cancelled')
})
