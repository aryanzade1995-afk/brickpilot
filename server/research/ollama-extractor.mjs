import { config } from './config.mjs'
import { deterministicPreParse } from './deterministic-preparser.mjs'

/**
 * Ollama Qwen3.5:2b extraction helper with structured outputs,
 * excerpt verification against source text, and bounded single retry.
 * Deterministic pre-parser runs first to bypass LLM for standard price formats.
 * NO MOCK DATA IN PRODUCTION PATHS.
 */

// JSON schema for Ollama structured output
const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    hasPrice: { type: 'boolean' },
    quotedPrice: { type: 'number' },
    quotedUnit: { type: 'string' },
    packSize: { type: ['number', 'null'] },
    pricingBasis: { type: 'string', enum: ['supply-only', 'labour-only', 'installed'] },
    taxIncluded: { type: ['boolean', 'string'] },
    deliveryIncluded: { type: ['boolean', 'string'] },
    minOrder: { type: ['string', 'null'] },
    publishedDate: { type: ['string', 'null'] },
    locationMentioned: { type: ['string', 'null'] },
    excerpt: { type: 'string' },
    specificationMatch: { type: 'string' },
    confidenceReasoning: { type: 'string' },
  },
  required: ['hasPrice', 'quotedPrice', 'quotedUnit', 'pricingBasis', 'excerpt'],
}

/**
 * Verifies that the excerpt quoted by the model is authentic and present in the source text.
 * Whitespace is normalized before checking.
 */
export function verifyExcerpt(excerpt, sourceText) {
  if (!excerpt || typeof excerpt !== 'string') return false
  const cleanExcerpt = excerpt.replace(/\s+/g, ' ').trim().toLowerCase()
  const cleanSource = (sourceText || '').replace(/\s+/g, ' ').toLowerCase()
  if (cleanExcerpt.length < 5) return false
  return cleanSource.includes(cleanExcerpt)
}

export class ExtractionFailedError extends Error {
  constructor(message, code = 'EXTRACTION_OLLAMA_UNREACHABLE') {
    super(message)
    this.name = 'ExtractionFailedError'
    this.code = code
  }
}

export class OllamaExtractor {
  constructor(customConfig = {}, testFixtures = null) {
    this.cfg = { ...config, ...customConfig }
    this.fixtures = testFixtures
  }

  /**
   * Extract price evidence from a fetched document using local Ollama model.
   * If Ollama is unreachable, times out, or returns invalid output after 1 retry:
   * Throws ExtractionFailedError with safe error code. Never substitutes mock data.
   */
  async extractPriceEvidence(target, doc, options = {}) {
    if (!doc?.textSample) return null

    const signal = options.signal
    const allowPreParser = options.deterministicPreParser ?? this.cfg.deterministicPreParser ?? true
    const mode = options.mode ?? this.cfg.mode ?? 'hybrid'

    // 1. Deterministic pre-parser pass: Bypasses LLM overhead for standard price formats
    if (allowPreParser && mode !== 'llm-only') {
      const deterministicResult = deterministicPreParse(target, doc)
      if (deterministicResult && deterministicResult.quotedPrice > 0) {
        return deterministicResult
      }
      if (mode === 'deterministic-only') {
        return null
      }
    }

    // Test fixture support (only active if fixtures explicitly injected in test environment AND mock enabled)
    if (this.fixtures?.mockExtract && this.cfg.mock && !this.cfg.isProduction) {
      const mockResult = this.fixtures.mockExtract(target, doc)
      if (mockResult) return mockResult
    }

    const systemPrompt = `You are an expert Indian construction cost estimator and quantity surveyor.
Extract exact price quotation data for the target building material or trade item from the supplier webpage snippet.
Follow these critical rules:
1. Return ONLY valid JSON adhering strictly to the provided schema.
2. The "excerpt" field MUST be an EXACT, literal verbatim substring copy from the provided text sample. Do NOT rephrase or alter punctuation.
3. If no price is mentioned for this specific item, set "hasPrice": false and quotedPrice: 0.
4. Record quoted currency (only INR is accepted; convert lakh or crore to numbers if needed).
5. State whether the price is supply-only, labour-only, or fully installed.
6. Do NOT invent prices. If uncertain, set "hasPrice": false.`

    const userPrompt = `TARGET SPECIFICATION TO PRICE:
- Item: ${target.itemLabel} (${target.trade})
- Specification Summary: ${target.specSummary}
- Target Standard Unit: ${target.requiredUnit}
- Target Rate ID: ${target.rateId}

SUPPLIER WEBPAGE SNIPPET:
- URL: ${doc.url}
- Publisher: ${doc.publisher}
- Text Sample:
"""
${doc.textSample.slice(0, 4000)}
"""

Extract the quotation adhering to the JSON schema. Remember: excerpt MUST be a verbatim substring.`

    let attempt = 0
    let lastError = null
    let lastErrorCode = 'EXTRACTION_OLLAMA_UNREACHABLE'

    while (attempt < 2) {
      attempt++
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 20000)
        const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

        let res
        try {
          res = await fetch(`${this.cfg.ollamaBaseUrl}/api/chat`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(this.cfg.ollamaApiKey ? { authorization: `Bearer ${this.cfg.ollamaApiKey}` } : {}),
            },
            body: JSON.stringify({
              model: this.cfg.ollamaModel,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              stream: false,
              format: EXTRACTION_JSON_SCHEMA,
              options: {
                temperature: 0.1,
                num_predict: 512,
              },
            }),
            signal: combinedSignal,
          })
        } catch (fetchErr) {
          if (fetchErr.name === 'AbortError') {
            lastErrorCode = 'EXTRACTION_TIMEOUT'
            throw new Error(`Ollama extraction timed out: ${fetchErr.message}`)
          }
          lastErrorCode = 'EXTRACTION_OLLAMA_UNREACHABLE'
          throw new Error(`Ollama connection failed: ${fetchErr.message}`)
        } finally {
          clearTimeout(timeout)
        }

        if (!res.ok) {
          lastErrorCode = 'EXTRACTION_OLLAMA_UNREACHABLE'
          throw new Error(`HTTP ${res.status} from Ollama: ${await res.text().catch(() => '')}`)
        }

        const data = await res.json()
        const rawContent = data.message?.content
        if (!rawContent) {
          lastErrorCode = 'EXTRACTION_INVALID_OUTPUT'
          throw new Error('Empty response content from Ollama')
        }

        let parsed
        try {
          parsed = JSON.parse(rawContent)
        } catch {
          lastErrorCode = 'EXTRACTION_INVALID_OUTPUT'
          throw new Error(`Failed to parse Ollama JSON response: ${rawContent.slice(0, 100)}`)
        }

        if (!parsed.hasPrice || !parsed.quotedPrice || parsed.quotedPrice <= 0) {
          return null
        }

        // Verify excerpt authenticity against document text
        if (!verifyExcerpt(parsed.excerpt, doc.textSample)) {
          lastErrorCode = 'EXTRACTION_INVALID_OUTPUT'
          throw new Error(`Extracted excerpt was not found in source text: "${parsed.excerpt?.slice(0, 80)}"`)
        }

        let tax = 'unknown'
        if (typeof parsed.taxIncluded === 'boolean') tax = parsed.taxIncluded
        let delivery = 'unknown'
        if (typeof parsed.deliveryIncluded === 'boolean') delivery = parsed.deliveryIncluded

        let basis = 'supply-only'
        if (['supply-only', 'labour-only', 'installed'].includes(parsed.pricingBasis)) {
          basis = parsed.pricingBasis
        }

        return {
          evidenceId: `ev_${target.rateId}_${doc.docId || 'doc'}`,
          targetId: target.targetId,
          rateId: target.rateId,
          docId: doc.docId || 'doc',
          url: doc.url,
          publisher: doc.publisher,
          publishedDate: parsed.publishedDate || null,
          fetchTimestamp: doc.fetchTimestamp,
          quotedPrice: parsed.quotedPrice,
          quotedCurrency: 'INR',
          quotedUnit: String(parsed.quotedUnit || target.requiredUnit).trim(),
          packSize: typeof parsed.packSize === 'number' ? parsed.packSize : null,
          pricingBasis: basis,
          taxIncluded: tax,
          deliveryIncluded: delivery,
          minOrder: parsed.minOrder ? String(parsed.minOrder).slice(0, 200) : null,
          locationMentioned: parsed.locationMentioned ? String(parsed.locationMentioned).slice(0, 200) : null,
          excerpt: String(parsed.excerpt),
          confidenceReasoning: String(parsed.confidenceReasoning || 'Extracted via Ollama'),
          specificationMatch: String(parsed.specificationMatch || target.specSummary),
        }
      } catch (err) {
        lastError = err.message
        if (attempt >= 2) {
          // Bounded retry exhausted: throw safe extraction failure error
          throw new ExtractionFailedError(lastError, lastErrorCode)
        }
      }
    }

    throw new ExtractionFailedError(lastError || 'Extraction failed after retry', lastErrorCode)
  }
}

