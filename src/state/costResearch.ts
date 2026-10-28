import { create } from 'zustand'
import type {
  ResearchLocation,
  ScopeMode,
  CostResearchJob,
  AcceptedPricingSnapshot,
  ManualRateOverride,
  InteriorItemSchedule,
  PricingContext,
  ResearchedRateOverride,
} from '@/lib/cost/research/types.ts'
import type { Design } from '@/lib/engine/types.ts'
import type { Brief } from '@/lib/model/brief.ts'
import type { CostSelection } from '@/lib/cost/specifications.ts'
import { estimationFingerprint } from '@/lib/cost/research/fingerprint.ts'
import { useStudio } from './studio.ts'

export interface CostResearchState {
  location: ResearchLocation
  scopeMode: ScopeMode
  activeJob: CostResearchJob | null
  isResearching: boolean
  jobError: string | null
  acceptedSnapshot: AcceptedPricingSnapshot | null
  manualOverrides: Record<string, ManualRateOverride>
  interiorSchedule: InteriorItemSchedule | null

  // Actions
  setLocation: (location: Partial<ResearchLocation>) => void
  setScopeMode: (scope: ScopeMode) => void
  startResearch: (payload: {
    design: Design
    brief: Brief
    commercial?: CostSelection | null
  }) => Promise<void>
  cancelResearch: () => Promise<void>
  applyProposedRates: (rateIds?: string[]) => void
  setManualOverride: (rateId: string, override: Partial<ManualRateOverride>) => void
  removeManualOverride: (rateId: string) => void
  clearAcceptedSnapshot: () => void
  setInteriorSchedule: (schedule: InteriorItemSchedule | null) => void
  toggleInteriorItem: (itemId: string, included: boolean) => void
  getPricingContext: () => PricingContext
  loadSavedResearchState: (saved: {
    acceptedSnapshot?: AcceptedPricingSnapshot | null
    manualOverrides?: Record<string, ManualRateOverride> | null
    interiorSchedule?: InteriorItemSchedule | null
    location?: ResearchLocation | null
    scopeMode?: ScopeMode | null
  }) => void
  reset: () => void
}

let pollInterval: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

export const useCostResearch = create<CostResearchState>((set, get) => ({
  location: {
    city: 'Pune',
    country: 'IN',
    currency: 'INR',
  },
  scopeMode: 'combined',
  activeJob: null,
  isResearching: false,
  jobError: null,
  acceptedSnapshot: null,
  manualOverrides: {},
  interiorSchedule: null,

  setLocation: (loc) =>
    set((state) => ({
      location: { ...state.location, ...loc },
    })),

  setScopeMode: (scopeMode) => set({ scopeMode }),

  startResearch: async ({ design, brief, commercial }) => {
    stopPolling()
    const { location, scopeMode, interiorSchedule } = get()

    const fingerprint = estimationFingerprint(
      design,
      brief,
      commercial,
      location,
      scopeMode,
      interiorSchedule,
      get().acceptedSnapshot?.id || 'baseline',
    )

    set({ isResearching: true, jobError: null })

    try {
      const res = await fetch('/api/cost-research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          design,
          brief,
          commercial,
          location,
          scopeMode,
          interiorSchedule,
          acceptedSnapshotId: get().acceptedSnapshot?.id || 'baseline',
          sourceFingerprint: fingerprint,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${res.status} from research service`)
      }

      const { jobId } = await res.json()

      // Start polling status
      pollInterval = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/cost-research/${jobId}`)
          if (!pollRes.ok) return
          const job: CostResearchJob = await pollRes.json()

          // Check live studio state to detect edits or project switches mid-job
          const liveStudio = useStudio.getState()
          const liveDesign = liveStudio.result?.design ?? design
          const liveBrief = liveStudio.brief ?? brief
          const liveCommercial = commercial



          const currentFingerprint = estimationFingerprint(
            liveDesign,
            liveBrief,
            liveCommercial,
            get().location,
            get().scopeMode,
            get().interiorSchedule,
            get().acceptedSnapshot?.id || 'baseline',
          )

          const isMatchingPlan = job.sourceFingerprint === currentFingerprint

          if (!isMatchingPlan) {
            // Plan or project was modified mid-job: mark result historical proposal, do not apply, stop polling
            stopPolling()
            set({
              activeJob: {
                ...job,
                status: 'historical proposal',
                isHistorical: true,
              },
              isResearching: false,
              jobError: 'Historical proposal: Plan or project was modified during research; result cannot be auto-applied.',
            })
            return
          }

          set({ activeJob: job })

          if (['completed', 'partial', 'failed', 'cancelled', 'failed: interrupted'].includes(job.status)) {
            stopPolling()
            set({ isResearching: false })
            if (job.status === 'failed' || job.status === 'failed: interrupted') {
              set({ jobError: job.error || 'Cost research failed' })
            }
          }
        } catch (err) {
          console.warn('[costResearch] Polling error:', err)
        }
      }, 1200)
    } catch (err: unknown) {
      stopPolling()
      const msg = err instanceof Error ? err.message : String(err)
      set({ isResearching: false, jobError: msg })
    }
  },

  cancelResearch: async () => {
    stopPolling()
    const { activeJob } = get()
    if (activeJob?.jobId) {
      try {
        await fetch(`/api/cost-research/${activeJob.jobId}/cancel`, { method: 'POST' })
      } catch {}
    }
    set({ isResearching: false })
  },

  applyProposedRates: (rateIds?: string[]) => {
    const { activeJob, location, scopeMode } = get()
    if (!activeJob || activeJob.isHistorical || activeJob.status === 'historical proposal' || !activeJob.proposals.length) return
    if (activeJob.isMock) return

    // Never auto-apply conflicting, single-source, stale, unresolved, or unreadable proposals.
    // Only proposals the user explicitly selects AND whose status is 'accepted' may be applied.
    if (!rateIds || !Array.isArray(rateIds) || rateIds.length === 0) return

    const selectedProposals = activeJob.proposals.filter((p) => {
      if (p.status !== 'accepted') return false
      return rateIds.includes(p.rateId)
    })

    if (selectedProposals.length === 0) return


    const rates: Record<string, ResearchedRateOverride> = {}
    const now = new Date().toISOString()

    for (const prop of selectedProposals) {
      const sources = prop.evidence
        .filter((e) => e.valid)
        .map((e) => ({
          url: e.url,
          publisher: e.publisher,
          date: e.publishedDate,
          fetchTimestamp: e.fetchTimestamp,
          excerpt: e.excerpt,
        }))

      rates[prop.rateId] = {
        rateId: prop.rateId,
        unit: prop.unit,
        material: prop.proposedMaterial,
        labour: prop.proposedLabour,
        installed: prop.proposedInstalled,
        pricingBasis: prop.pricingBasis,
        sources,
        appliedAt: now,
        notes: prop.selectionReason,
      }
    }

    const snapshot: AcceptedPricingSnapshot = {
      id: `snapshot_${Date.now()}`,
      createdAt: now,
      location,
      scope: scopeMode,
      sourceFingerprint: activeJob.sourceFingerprint,
      rates,
      unresolvedGaps: activeJob.unresolvedTargets.map((u) => ({
        rateId: u.rateId,
        itemLabel: activeJob.proposals.find((p) => p.rateId === u.rateId)?.itemLabel || u.rateId,
        reason: u.reason,
      })),
    }

    set({ acceptedSnapshot: snapshot })
  },

  setManualOverride: (rateId, override) => {
    set((state) => {
      const current = state.manualOverrides[rateId] || {
        rateId,
        unit: 'item',
        material: 0,
        labour: 0,
        installed: 0,
        updatedAt: new Date().toISOString(),
      }

      const mat = override.material ?? current.material
      const lab = override.labour ?? current.labour
      const inst = override.installed ?? (mat + lab)

      return {
        manualOverrides: {
          ...state.manualOverrides,
          [rateId]: {
            ...current,
            ...override,
            material: mat,
            labour: lab,
            installed: inst,
            updatedAt: new Date().toISOString(),
          },
        },
      }
    })
  },

  removeManualOverride: (rateId) => {
    set((state) => {
      const next = { ...state.manualOverrides }
      delete next[rateId]
      return { manualOverrides: next }
    })
  },

  clearAcceptedSnapshot: () => {
    set({ acceptedSnapshot: null })
  },

  setInteriorSchedule: (interiorSchedule) => {
    set({ interiorSchedule })
  },

  toggleInteriorItem: (itemId, included) => {
    set((state) => {
      if (!state.interiorSchedule) return state
      const nextItems = state.interiorSchedule.items.map((i) =>
        i.id === itemId ? { ...i, includedInEstimate: included } : i,
      )
      const totalAmount = nextItems.filter((i) => i.includedInEstimate).reduce((sum, i) => sum + i.amount, 0)
      return {
        interiorSchedule: {
          ...state.interiorSchedule,
          items: nextItems,
          totalAmount,
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  getPricingContext: () => {
    const { acceptedSnapshot, manualOverrides, location, scopeMode, interiorSchedule } = get()
    return {
      id: acceptedSnapshot?.id || 'baseline',
      location: acceptedSnapshot?.location || location,
      rates: acceptedSnapshot?.rates || {},
      manualOverrides,
      interiorSchedule: interiorSchedule || undefined,
      scopeMode,
    }
  },

  loadSavedResearchState: (saved) => {
    stopPolling()
    set({
      acceptedSnapshot: saved.acceptedSnapshot || null,
      manualOverrides: saved.manualOverrides || {},
      interiorSchedule: saved.interiorSchedule || null,
      location: saved.location || { city: 'Pune', country: 'IN', currency: 'INR' },
      scopeMode: saved.scopeMode || 'combined',
      activeJob: null,
      isResearching: false,
      jobError: null,
    })
  },

  reset: () => {
    stopPolling()
    set({
      activeJob: null,
      isResearching: false,
      jobError: null,
      acceptedSnapshot: null,
      manualOverrides: {},
      interiorSchedule: null,
    })
  },
}))
