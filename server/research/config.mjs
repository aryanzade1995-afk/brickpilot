/*
 * Server-side Cost Research Configuration
 * Only read on server; never exposed to browser.
 */

const isProduction = process.env.NODE_ENV === 'production'

// Dev mock mode: strictly forbidden in production; requires explicit env flag
const isDevMock = !isProduction && process.env.COST_RESEARCH_DEV_MOCK === '1'

// Local mode: strictly forbidden in production; defaults to true in non-production unless explicit
const isLocalMode = !isProduction && (process.env.COST_RESEARCH_LOCAL_MODE === '1' || process.env.NODE_ENV !== 'production')

export const outlierConfig = {
  // Spread cap on agreeing independent publishers (default: 35% -> 0.35)
  maxSpreadRatio: Number(process.env.COST_RESEARCH_SPREAD_CAP) || 0.35,
  // Clustering around median of independent publisher quotes (default: 25% -> 0.25)
  clusterTolerance: Number(process.env.COST_RESEARCH_CLUSTER_TOLERANCE) || 0.25,
  // Minimum number of independent publishers required for accepted consensus (default: 2)
  minIndependentPublishers: Number(process.env.COST_RESEARCH_MIN_PUBLISHERS) || 2,
  // Freshness bands (in days from publication date to reference date)
  freshMaxDays: Number(process.env.COST_RESEARCH_FRESH_DAYS) || 90,
  acceptableMaxDays: Number(process.env.COST_RESEARCH_MAX_DAYS) || 180,
  // Single-source baseline sanity bounds (ratio to baseline installed)
  singleSourceMinRatio: Number(process.env.COST_RESEARCH_SINGLE_MIN_RATIO) || 0.4,
  singleSourceMaxRatio: Number(process.env.COST_RESEARCH_SINGLE_MAX_RATIO) || 2.5,
  // Gross sanity bounds for raw normalized rates (ratio to baseline installed)
  grossSanityMinRatio: Number(process.env.COST_RESEARCH_GROSS_MIN_RATIO) || 0.05,
  grossSanityMaxRatio: Number(process.env.COST_RESEARCH_GROSS_MAX_RATIO) || 7.0,
}

export const config = {
  enabled: process.env.COST_RESEARCH_ENABLED !== 'false',
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, ''),
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3.5:2b',
  ollamaApiKey: process.env.OLLAMA_API_KEY || null,
  searchEndpoint: process.env.SEARCH_ENDPOINT || null,
  searchApiKey: process.env.SEARCH_API_KEY || null,
  timeoutMs: Number(process.env.COST_RESEARCH_TIMEOUT_MS) || 90000,
  maxConcurrency: Number(process.env.COST_RESEARCH_MAX_CONCURRENCY) || 2,
  cacheTtlHours: Number(process.env.COST_RESEARCH_CACHE_TTL_HOURS) || 24,
  allowedOrigins: (process.env.COST_RESEARCH_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8787,http://127.0.0.1:5173,http://127.0.0.1:8787')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  localMode: isLocalMode,
  mock: isDevMock,
  isProduction,
  outlier: outlierConfig,
}

