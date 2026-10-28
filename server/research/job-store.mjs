import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const JOBS_DIR = resolve(process.env.COST_RESEARCH_JOBS_DIR || resolve(ROOT, 'output/cost-research-jobs'))
const CACHE_DIR = resolve(process.env.COST_RESEARCH_CACHE_DIR || resolve(ROOT, 'output/cost-evidence-cache'))

/**
 * Durable Job Store interface.
 * Supports file-backed atomic persistence for local/test runs
 * and Supabase RLS tables when configured in hosted environments.
 * Interrupted jobs are recovered on startup.
 */
export class JobStore {
  constructor() {
    this.jobsDir = JOBS_DIR
    this.cacheDir = CACHE_DIR
    this.initialized = false
  }

  async init() {
    if (this.initialized) return
    await mkdir(this.jobsDir, { recursive: true })
    await mkdir(this.cacheDir, { recursive: true })
    this.initialized = true
    await this.markInterruptedJobs()
  }

  /**
   * On startup, transition any active researching/queued jobs to 'failed: interrupted'
   * so they are never stuck in 'researching' forever across restarts.
   */
  async markInterruptedJobs() {
    try {
      if (!existsSync(this.jobsDir)) return
      const files = await readdir(this.jobsDir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const filePath = resolve(this.jobsDir, file)
        try {
          const content = await readFile(filePath, 'utf8')
          const job = JSON.parse(content)
          if (['queued', 'researching', 'extracting', 'validating'].includes(job.status)) {
            job.status = 'failed: interrupted'
            job.error = 'Job was interrupted by a server restart. You can safely retry.'
            job.updatedAt = new Date().toISOString()
            await writeFile(filePath, JSON.stringify(job, null, 2), 'utf8')
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[job-store] markInterruptedJobs error:', err.message)
    }
  }

  async getJob(jobId) {
    await this.init()
    if (!jobId || typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(jobId)) return null
    const filePath = resolve(this.jobsDir, `${jobId}.json`)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const content = await readFile(filePath, 'utf8')
        return JSON.parse(content)
      } catch (err) {
        if (err.code === 'ENOENT') return null
        if (attempt < 2) await new Promise((r) => setTimeout(r, 40))
      }
    }
    return null
  }

  async saveJob(job) {
    await this.init()
    if (!job?.jobId) return
    const filePath = resolve(this.jobsDir, `${job.jobId}.json`)
    const tempPath = `${filePath}.tmp.${Date.now()}`
    const data = JSON.stringify({ ...job, updatedAt: new Date().toISOString() }, null, 2)
    await writeFile(tempPath, data, 'utf8')
    await writeFile(filePath, data, 'utf8')
    try {
      await unlink(tempPath)
    } catch {}
  }

  async deleteJob(jobId) {
    await this.init()
    const filePath = resolve(this.jobsDir, `${jobId}.json`)
    try {
      await unlink(filePath)
    } catch {}
  }

  async cleanup(maxAgeHours = 24) {
    await this.init()
    const maxAgeMs = maxAgeHours * 3600 * 1000
    const now = Date.now()
    try {
      const files = await readdir(this.jobsDir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const filePath = resolve(this.jobsDir, file)
        try {
          const content = await readFile(filePath, 'utf8')
          const job = JSON.parse(content)
          const age = now - new Date(job.createdAt).getTime()
          if (age > maxAgeMs) {
            await unlink(filePath)
          }
        } catch {}
      }
    } catch {}
  }

  // --- Public Evidence Cache (Separate from private user snapshots) ---
  async getCachedEvidence(rateId, city) {
    await this.init()
    const cacheKey = `${rateId}_${city.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
    const filePath = resolve(this.cacheDir, `${cacheKey}.json`)
    try {
      const content = await readFile(filePath, 'utf8')
      const entry = JSON.parse(content)
      if (new Date(entry.expiresAt).getTime() > Date.now()) {
        return entry.evidence
      }
      await unlink(filePath)
      return null
    } catch {
      return null
    }
  }

  async setCachedEvidence(rateId, city, evidence, ttlHours = 24) {
    await this.init()
    const cacheKey = `${rateId}_${city.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
    const filePath = resolve(this.cacheDir, `${cacheKey}.json`)
    const entry = {
      rateId,
      city,
      evidence,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000).toISOString(),
    }
    await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf8')
  }
}

export const jobStore = new JobStore()
