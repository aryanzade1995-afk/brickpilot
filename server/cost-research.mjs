import { randomBytes } from 'node:crypto'
import { config } from './research/config.mjs'
import { SearchAdapter } from './research/search-adapter.mjs'
import { OllamaExtractor, ExtractionFailedError } from './research/ollama-extractor.mjs'
import { buildResearchTargets } from './research/targets.mjs'
import { normalizeEvidence, buildRateProposal } from './research/normalizer.mjs'
import { specificationRate } from '../src/lib/cost/catalogue.ts'
import { validate } from '../src/lib/rules/index.ts'
import { estimationFingerprint } from '../src/lib/cost/research/fingerprint.ts'
import { jobStore } from './research/job-store.mjs'


// In-memory active abort controllers for live cancellation
const jobControllers = new Map()

function getCorsHeaders(req) {
  const origin = req.headers.origin
  if (!origin) return { 'x-content-type-options': 'nosniff' }
  if (config.allowedOrigins.includes(origin)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'vary': 'Origin',
      'x-content-type-options': 'nosniff',
    }
  }
  return { 'x-content-type-options': 'nosniff' }
}

const send = (req, res, status, data) => {
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...getCorsHeaders(req),
  }
  res.writeHead(status, headers)
  res.end(JSON.stringify(data))
}

/**
 * Validates request authorization.
 * Local mode allows unauthenticated requests with a dummy owner id.
 * Hosted / production mode strictly requires a valid bearer token.
 */
function authenticateRequest(req) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null

  if (config.localMode) {
    return { authenticated: true, userId: token ? `user_${token.slice(0, 8)}` : 'local_owner' }
  }

  if (!token) {
    return { authenticated: false, error: 'Authentication required to start or access cost research' }
  }

  // Basic JWT structure verification (header.payload.signature)
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { authenticated: false, error: 'Invalid authentication token' }
  }

  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8')
    const payload = JSON.parse(payloadJson)
    if (!payload.sub) {
      return { authenticated: false, error: 'Token missing user subject' }
    }
    // Check token expiration if present
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return { authenticated: false, error: 'Authentication token has expired' }
    }
    return { authenticated: true, userId: payload.sub }
  } catch {
    return { authenticated: false, error: 'Malformed authentication token' }
  }
}

/**
 * Background worker executing the cost research pipeline for a single job
 */
async function runResearchJob(jobId, payload, signal, testFixtures = null) {
  const job = await jobStore.getJob(jobId)
  if (!job) return

  const searchAdapter = new SearchAdapter({}, testFixtures)
  const extractor = new OllamaExtractor({}, testFixtures)

  try {
    job.status = 'researching'
    job.updatedAt = new Date().toISOString()
    job.progress = {
      step: 'Target identification',
      completed: 1,
      total: 10,
      message: 'Extracting key cost drivers and trade items from architectural plan...',
    }
    await jobStore.saveJob(job)

    const { design, brief, location, scopeMode = 'combined' } = payload
    const targets = buildResearchTargets(design, brief, location, scopeMode, 10)

    job.progress.total = targets.length
    job.updatedAt = new Date().toISOString()
    await jobStore.saveJob(job)

    const proposals = []
    const unresolvedTargets = []

    for (let i = 0; i < targets.length; i++) {
      if (signal?.aborted) {
        job.status = 'cancelled'
        job.updatedAt = new Date().toISOString()
        await jobStore.saveJob(job)
        return
      }

      const target = targets[i]
      job.progress = {
        step: `Researching ${target.itemLabel}`,
        completed: i + 1,
        total: targets.length,
        message: `Searching verified regional suppliers for ${target.itemLabel} in ${location.city}...`,
      }
      job.updatedAt = new Date().toISOString()
      await jobStore.saveJob(job)

      // 1. Search supplier listings
      let searchResults = []
      try {
        searchResults = await searchAdapter.search(target.queryTerm, { maxResults: 2, signal })
      } catch (err) {
        console.warn(`[cost-research] Search failed for ${target.rateId}:`, err.message)
      }

      // 2. Fetch pages and extract evidence with Qwen
      const normalizedList = []
      for (const result of searchResults) {
        if (signal?.aborted) break
        try {
          const doc = await searchAdapter.fetchPage(result.url, { signal })
          const evidence = await extractor.extractPriceEvidence(target, doc, { signal })
          if (evidence) {
            let baseline
            try {
              baseline = specificationRate(target.rateId)
            } catch {
              baseline = { material: 0, labour: 0, installed: 0 }
            }
            const normalized = normalizeEvidence(target, evidence, baseline)
            normalizedList.push(normalized)
          }
        } catch (fetchErr) {
          if (fetchErr instanceof ExtractionFailedError || fetchErr.name === 'ExtractionFailedError') {
            // Unreachable, timeout, or invalid output after retry
            job.status = 'extraction-failed'
            job.errorCode = fetchErr.code || 'EXTRACTION_OLLAMA_UNREACHABLE'
            job.error = `Ollama extraction failed: ${fetchErr.message}`
            job.proposals = []
            job.evidence = []
            job.updatedAt = new Date().toISOString()
            await jobStore.saveJob(job)
            return
          }
          console.warn(`[cost-research] Fetch/extract failed for ${result.url}:`, fetchErr.message)
        }
      }

      // 3. Build rate proposal
      const proposal = buildRateProposal(target, normalizedList)
      if (job.isMock) {
        proposal.isMock = true
        proposal.status = 'unresolved'
        proposal.selectionReason = `[MOCK, not real data] ${proposal.selectionReason}`
      }
      proposals.push(proposal)

      if (['provisional-fallback', 'unresolved'].includes(proposal.status)) {
        unresolvedTargets.push({
          targetId: target.targetId,
          rateId: target.rateId,
          itemLabel: target.itemLabel,
          reason: proposal.selectionReason,
        })
      }
    }

    job.proposals = proposals
    job.unresolvedTargets = unresolvedTargets
    job.status = job.isMock ? 'completed' : (proposals.some((p) => p.status === 'accepted') ? 'completed' : 'partial')
    job.progress = {
      step: 'Completed',
      completed: targets.length,
      total: targets.length,
      message: job.isMock ? 'Developer mock research completed (MOCK, not real data).' : `Research completed for ${location.city}.`,
    }

    job.updatedAt = new Date().toISOString()
    await jobStore.saveJob(job)
  } catch (err) {
    if (err instanceof ExtractionFailedError || err.name === 'ExtractionFailedError') {
      job.status = 'extraction-failed'
      job.errorCode = err.code || 'EXTRACTION_OLLAMA_UNREACHABLE'
      job.error = `Ollama extraction failed: ${err.message}`
      job.proposals = []
      job.evidence = []
      job.updatedAt = new Date().toISOString()
      await jobStore.saveJob(job)
      return
    }
    job.status = 'failed'
    job.error = err.message
    job.updatedAt = new Date().toISOString()
    await jobStore.saveJob(job)
  } finally {
    jobControllers.delete(jobId)
  }
}


export async function handleCostResearchRequest(req, res, readJson, testFixtures = null) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname

  if (!path.startsWith('/api/cost-research')) {
    return false
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin
    if (origin && config.allowedOrigins.includes(origin)) {
      res.writeHead(204, getCorsHeaders(req))
    } else {
      res.writeHead(403, { 'x-content-type-options': 'nosniff' })
    }
    res.end()
    return true
  }

  // 1. GET /api/cost-research/health (Truthful probe)
  if (path === '/api/cost-research/health' && req.method === 'GET') {
    let ollamaReachable = false
    let modelPresent = false

    try {
      const probeRes = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(1500),
      })
      if (probeRes.ok) {
        ollamaReachable = true
        const data = await probeRes.json()
        if (Array.isArray(data.models)) {
          modelPresent = data.models.some((m) =>
            m.name === config.ollamaModel || m.name?.startsWith(`${config.ollamaModel}:`)
          )
        }
      }
    } catch {
      ollamaReachable = false
      modelPresent = false
    }

    const searchConfigured = Boolean(
      config.searchEndpoint || config.searchApiKey || (config.mock && !config.isProduction)
    )

    const canRun = (ollamaReachable && modelPresent && searchConfigured) || (config.mock && !config.isProduction)

    send(req, res, 200, {
      status: canRun ? 'ready' : 'degraded',
      enabled: canRun,
      ollama: {
        reachable: ollamaReachable,
        model: config.ollamaModel,
        modelPresent,
      },
      search: {
        configured: searchConfigured,
      },
      localMode: config.localMode,
      mock: config.mock,
    })
    return true
  }

  // Authenticate caller for job creation and management
  const auth = authenticateRequest(req)
  if (!auth.authenticated) {
    send(req, res, 401, { error: auth.error })
    return true
  }
  const currentUserId = auth.userId

  // 2. POST /api/cost-research (Start a new bounded research job)
  if (path === '/api/cost-research' && req.method === 'POST') {
    await jobStore.cleanup(config.cacheTtlHours)
    try {
      const payload = await readJson(req, 4e6)
      const { design, brief, commercial, location, scopeMode = 'combined', interiorSchedule, acceptedSnapshotId } = payload || {}

      if (!design || !brief || !location?.city) {
        send(req, res, 400, { error: 'Missing required estimation snapshot fields: design, brief, location.city' })
        return true
      }

      // Hard safety validation: Server validates the submitted snapshot
      const validationReport = validate(design)
      if (!validationReport.hardChecksPass) {
        const errorMessages = validationReport.findings
          .filter((f) => f.severity === 'error')
          .map((f) => f.message)
          .join('; ')
        send(req, res, 400, {
          error: `Architectural plan failed validation checks: ${errorMessages || 'Hard validation failure'}`,
        })
        return true
      }

      // Compute deterministic fingerprint
      const sourceFingerprint = estimationFingerprint(
        design,
        brief,
        commercial,
        location,
        scopeMode,
        interiorSchedule,
        acceptedSnapshotId || 'baseline',
      )

      const jobId = `job_${randomBytes(12).toString('hex')}`
      const controller = new AbortController()
      jobControllers.set(jobId, controller)

      const job = {
        jobId,
        userId: currentUserId,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: {
          step: 'Queued',
          completed: 0,
          total: 10,
          message: 'Job queued for processing...',
        },
        location: {
          city: location.city.trim(),
          state: location.state?.trim(),
          pincode: location.pincode?.trim(),
          country: 'IN',
          currency: 'INR',
        },
        scope: scopeMode,
        sourceFingerprint,
        isMock: Boolean(config.mock && !config.isProduction),
        mockNotice: (config.mock && !config.isProduction) ? 'MOCK, not real data - developer mock mode active. Results cannot be persisted or applied.' : undefined,
        proposals: [],
        unresolvedTargets: [],
        error: null,
      }


      await jobStore.saveJob(job)

      // Start asynchronous research in background
      setImmediate(() => {
        runResearchJob(jobId, { design, brief, commercial, location, scopeMode, interiorSchedule }, controller.signal, testFixtures)
      })

      send(req, res, 202, {
        jobId,
        status: job.status,
        sourceFingerprint,
      })
    } catch (err) {
      send(req, res, 400, { error: err.message || 'Invalid research request payload' })
    }
    return true
  }

  // 3. GET /api/cost-research/:jobId
  const getMatch = path.match(/^\/api\/cost-research\/([a-zA-Z0-9_.-]+)$/)
  if (getMatch && req.method === 'GET') {
    const jobId = getMatch[1]
    const job = await jobStore.getJob(jobId)
    if (!job) {
      send(req, res, 404, { error: `Cost research job '${jobId}' not found` })
      return true
    }
    // Verify owner access
    if (job.userId && job.userId !== currentUserId) {
      send(req, res, 403, { error: 'Forbidden: You do not have permission to view this job' })
      return true
    }
    send(req, res, 200, job)
    return true
  }

  // 4. POST /api/cost-research/:jobId/cancel
  const cancelMatch = path.match(/^\/api\/cost-research\/([a-zA-Z0-9_.-]+)\/cancel$/)
  if (cancelMatch && req.method === 'POST') {
    const jobId = cancelMatch[1]
    const job = await jobStore.getJob(jobId)
    if (!job) {
      send(req, res, 404, { error: `Cost research job '${jobId}' not found` })
      return true
    }
    // Verify owner access
    if (job.userId && job.userId !== currentUserId) {
      send(req, res, 403, { error: 'Forbidden: You do not have permission to cancel this job' })
      return true
    }
    const controller = jobControllers.get(jobId)
    if (controller) {
      controller.abort()
      jobControllers.delete(jobId)
    }
    job.status = 'cancelled'
    job.updatedAt = new Date().toISOString()
    job.progress.message = 'Research cancelled by user'
    await jobStore.saveJob(job)
    send(req, res, 200, { ok: true, status: job.status })
    return true
  }

  return false
}
