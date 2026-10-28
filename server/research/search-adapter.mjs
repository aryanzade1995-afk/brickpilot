import { promises as dns } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { config } from './config.mjs'

const MAX_REDIRECTS = 3
const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'application/json',
  'application/ld+json',
]

/**
 * Checks whether an IP address (IPv4 or IPv6) is private, loopback,
 * link-local, cloud-metadata, or unspecified.
 */
export function isPrivateOrRestrictedIp(ip) {
  if (typeof ip !== 'string') return true
  let cleanIp = ip.trim().toLowerCase().replace(/^\[|\]$/g, '')

  // Handle IPv4-mapped IPv6 (::ffff:127.0.0.1)
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7)
  }


  // IPv4 checks
  const ipv4Match = cleanIp.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const [a, b, c, d] = [Number(ipv4Match[1]), Number(ipv4Match[2]), Number(ipv4Match[3]), Number(ipv4Match[4])]
    if ([a, b, c, d].some((octet) => octet < 0 || octet > 255)) return true

    if (a === 0) return true // Current network (0.0.0.0/8)
    if (a === 127) return true // Loopback (127.0.0.0/8)
    if (a === 10) return true // RFC 1918 Private (10.0.0.0/8)
    if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918 Private (172.16.0.0/12)
    if (a === 192 && b === 168) return true // RFC 1918 Private (192.168.0.0/16)
    if (a === 169 && b === 254) return true // Link-local / Cloud metadata (169.254.0.0/16)
    if (a === 100 && b >= 64 && b <= 127) return true // Carrier-grade NAT (100.64.0.0/10)
    if (a >= 224 && a <= 239) return true // Multicast (224.0.0.0/4)
    if (a >= 240) return true // Reserved / Broadcast (240.0.0.0/4)
    return false
  }

  // IPv6 checks
  if (cleanIp === '::' || cleanIp === '::1') return true // Unspecified & Loopback
  if (cleanIp.startsWith('fe80:') || cleanIp.startsWith('fe8') || cleanIp.startsWith('fe9') || cleanIp.startsWith('fea') || cleanIp.startsWith('feb')) {
    return true // Link-local (fe80::/10)
  }
  if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) {
    return true // Unique Local Address (fc00::/7)
  }
  if (cleanIp.startsWith('ff')) {
    return true // Multicast (ff00::/8)
  }

  return false
}

/**
 * Validates a hostname and ensures ALL resolved DNS addresses are safe public IPs.
 */
export async function validateSafeHost(hostname) {
  const host = hostname.toLowerCase().trim()
  if (['localhost', 'metadata.google.internal', 'instance-data'].includes(host)) {
    throw new Error(`SSRF blocked: Prohibited host '${host}'`)
  }

  // If the host is already an IP address, validate it directly
  if (isPrivateOrRestrictedIp(host)) {
    throw new Error(`SSRF blocked: Prohibited IP '${host}'`)
  }

  // Resolve DNS (IPv4 and IPv6)
  let addresses = []
  try {
    addresses = await dns.lookup(host, { all: true })
  } catch (err) {
    throw new Error(`DNS resolution failed for '${host}': ${err.message}`)
  }

  if (!addresses || addresses.length === 0) {
    throw new Error(`DNS resolution returned no addresses for '${host}'`)
  }

  for (const record of addresses) {
    if (isPrivateOrRestrictedIp(record.address)) {
      throw new Error(`SSRF blocked: Host '${host}' resolves to private/restricted IP '${record.address}'`)
    }
  }

  return addresses[0].address
}

/**
 * Clean HTML into readable plain text, removing script/style tags,
 * navigation chrome, and normalizing whitespace.
 */
export function cleanHtml(html) {
  if (typeof html !== 'string') return ''
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export class SearchAdapter {
  constructor(customConfig = {}, testFixtures = null) {
    this.cfg = { ...config, ...customConfig }
    this.fixtures = testFixtures
  }

  /**
   * Search for regional supplier quotations matching the query term.
   */
  async search(query, { maxResults = 3, signal } = {}) {
    // Test fixture support (only available when explicitly injected or in developer mock mode)
    if (this.fixtures?.mockPages && this.cfg.mock) {
      const q = query.toLowerCase()
      const results = []
      for (const [key, page] of Object.entries(this.fixtures.mockPages)) {
        if (q.includes(key) || results.length === 0) {
          results.push({
            url: page.url,
            title: `[MOCK, not real data] ${page.title}`,
            snippet: page.text.slice(0, 200),
          })
          if (results.length >= maxResults) break
        }
      }
      return results
    }

    // Live search via configured provider (Search Endpoint or Ollama web search)
    if (this.cfg.searchEndpoint) {
      try {
        const headers = { 'content-type': 'application/json' }
        if (this.cfg.searchApiKey) {
          headers['authorization'] = `Bearer ${this.cfg.searchApiKey}`
        }
        const res = await fetch(this.cfg.searchEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, limit: maxResults }),
          signal,
        })
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.results)) {
            return data.results.slice(0, maxResults).map((r) => ({
              url: r.url,
              title: r.title || 'Search result',
              snippet: r.snippet || '',
            }))
          }
        }
      } catch (err) {
        console.warn(`[search-adapter] Search endpoint error:`, err.message)
      }
    }

    return []
  }

  /**
   * Safe page fetcher with anti-SSRF protections:
   * 1. Protocol allowlist (http/https only)
   * 2. DNS resolution and pre-validation (blocks private/loopback/link-local/metadata IPs)
   * 3. Connects directly to pre-validated IP with Host/SNI headers (defeats DNS rebinding)
   * 4. Manual redirect loop with hop budget (max 3) and per-hop re-validation
   * 5. Content-Type filter (rejects non-text payloads)
   * 6. 2 MB body streaming limit (aborts stream if exceeded)
   */
  async fetchPage(targetUrl, { signal, hop = 0 } = {}) {
    if (hop > MAX_REDIRECTS) {
      throw new Error(`SSRF error: Exceeded maximum redirect hop limit (${MAX_REDIRECTS})`)
    }

    let parsed
    try {
      parsed = new URL(targetUrl)
    } catch {
      throw new Error(`Invalid URL format: ${targetUrl}`)
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Rejected unsafe protocol: ${parsed.protocol}`)
    }

    // Test fixture support (only active if fixtures injected)
    if (this.fixtures?.mockPages && this.cfg.mock) {
      for (const page of Object.values(this.fixtures.mockPages)) {
        if (page.url === targetUrl) {
          return {
            url: targetUrl,
            title: `[MOCK, not real data] ${page.title}`,
            publisher: page.publisher,
            textSample: page.text,
            fetchTimestamp: new Date().toISOString(),
          }
        }
      }
    }

    // Resolve DNS and validate IP address
    const safeIp = await validateSafeHost(parsed.hostname)

    // Execute HTTP request connecting to safeIp while maintaining Host and SNI
    const isHttps = parsed.protocol === 'https:'
    const client = isHttps ? https : http
    const defaultPort = isHttps ? 443 : 80
    const port = parsed.port ? Number(parsed.port) : defaultPort

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error('Fetch aborted by signal'))
      }

      const reqOptions = {
        host: safeIp,
        port,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'Host': parsed.host,
          'User-Agent': 'Mozilla/5.0 (compatible; FormsteadCostResearch/1.0)',
          'Accept': 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9',
        },
        servername: parsed.hostname, // TLS SNI
        timeout: 15000,
      }

      const req = client.request(reqOptions, (res) => {
        // 1. Check for redirects (301, 302, 303, 307, 308)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy()
          const nextUrl = new URL(res.headers.location, targetUrl).href
          return resolve(this.fetchPage(nextUrl, { signal, hop: hop + 1 }))
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          req.destroy()
          return reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}`))
        }

        // 2. Validate Content-Type
        const rawContentType = res.headers['content-type'] || ''
        const mime = rawContentType.split(';')[0].trim().toLowerCase()
        const isAllowedType = ALLOWED_CONTENT_TYPES.some((allowed) => mime === allowed || mime.startsWith('text/'))
        if (!isAllowedType && mime) {
          req.destroy()
          return reject(new Error(`Rejected non-text content type: ${rawContentType}`))
        }

        // 3. Stream body and enforce 2 MB cap
        let totalBytes = 0
        let chunks = []

        res.on('data', (chunk) => {
          totalBytes += chunk.length
          if (totalBytes > MAX_BODY_BYTES) {
            req.destroy(new Error(`Response body exceeds ${MAX_BODY_BYTES} bytes limit`))
          } else {
            chunks.push(chunk)
          }
        })

        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8')
          const cleanedText = cleanHtml(bodyText)
          resolve({
            url: targetUrl,
            title: `Supplier Quote (${parsed.hostname})`,
            publisher: parsed.hostname,
            textSample: cleanedText.slice(0, 8000),
            fetchTimestamp: new Date().toISOString(),
          })
        })

        res.on('error', (err) => {
          reject(err)
        })
      })

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy(new Error('Fetch aborted by signal'))
        })
      }

      req.on('timeout', () => {
        req.destroy(new Error(`Connection timeout fetching ${parsed.hostname}`))
      })

      req.on('error', (err) => {
        reject(err)
      })

      req.end()
    })
  }
}
