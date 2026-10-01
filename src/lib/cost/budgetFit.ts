import { FINISH_LABEL, type Brief, type Finish } from '../model/brief.ts'
import { compile } from '../model/canonical.ts'
import { costPerSqmAllIn } from './index.ts'

/* ------------------------------------------------------------------ *
 *  Budget fit — checked on the brief alone, before any plan exists
 *  (the money twin of planner/fit.ts). Pure functions.
 * ------------------------------------------------------------------ */

/**
 * Built-up m² per m² of requested rooms: walls, the full-length corridor on
 * every floor, the stair repeated per storey, and rooms stretched to fill the
 * structural bays. Calibrated against generated plans (scripts/test-cost.mjs):
 * the per-brief best fit ran 1.14–1.53, and 1.27 follows the current connected-wing plans within ±20%.
 * (The first guess of 1.18 fell 16–23% short on most briefs.)
 */
export const GROSS_UP = 1.27

export type BudgetFitStatus = 'comfortable' | 'tight' | 'over'

export type BudgetFit = {
  minSqm: number
  targetSqm: number
  maxSqm: number
  status: BudgetFitStatus
  message: string
}

export type BudgetCut = {
  label: string
  /** apply to a brief draft (e.g. inside studio.edit) */
  patch: (b: Brief) => void
  /** estimated cost saved at target room sizes, lakh */
  savesLakh: number
}

/** built-up area the requested rooms need, at minimum and at target sizes */
export function areaNeeded(brief: Brief): { minSqm: number; targetSqm: number } {
  const spaces = compile(brief).floors.flatMap((f) => f.spaces).filter((s) => !s.outdoor)
  const sum = (k: 'min' | 'target') => spaces.reduce((a, s) => a + (k === 'target' ? s.preferredTarget ?? s.target : s.min), 0) * GROSS_UP
  return { minSqm: Math.round(sum('min')), targetSqm: Math.round(sum('target')) }
}

/** the most built-up area the budget pays for, all in */
export function maxAffordableSqm(brief: Brief): number {
  return Math.round((brief.budget.amountLakh * 1e5) / costPerSqmAllIn(brief))
}

const lakh = (inr: number) => Math.round(inr / 1e5)

export function assessBudgetFit(brief: Brief): BudgetFit {
  const { minSqm, targetSqm } = areaNeeded(brief)
  const maxSqm = maxAffordableSqm(brief)
  const status: BudgetFitStatus = targetSqm <= maxSqm ? 'comfortable' : minSqm <= maxSqm ? 'tight' : 'over'
  const message = `Your rooms need about ${targetSqm} m²; ₹${brief.budget.amountLakh} L covers about ${maxSqm} m² at ${FINISH_LABEL[brief.budget.finish].toLowerCase()} finish.`
  return { minSqm, targetSqm, maxSqm, status, message }
}

const FINISH_DOWN: Partial<Record<Finish, Finish>> = { premium: 'mid', mid: 'basic' }

/** rooms the household's seniors are owed (T3: up to two share a room with bath) */
function seniorRooms(b: Brief): number {
  const members = b.household.members
  return Math.max(
    Math.ceil(members.filter((m) => m.role === 'senior').length / 2),
    Math.ceil(members.filter((m) => m.needsGroundFloor).length / 2),
  )
}

type Candidate = { label: string | ((b: Brief) => string); applies: (b: Brief) => boolean; patch: (b: Brief) => void }

const CANDIDATES: Candidate[] = [
  {
    label: (b) => `Lower the finish from ${FINISH_LABEL[b.budget.finish].toLowerCase()} to ${FINISH_LABEL[FINISH_DOWN[b.budget.finish] ?? b.budget.finish].toLowerCase()}`,
    applies: (b) => !!FINISH_DOWN[b.budget.finish],
    patch: (b) => void (b.budget.finish = FINISH_DOWN[b.budget.finish] ?? b.budget.finish),
  },
  { label: 'One fewer bedroom without attached bath', applies: (b) => b.rooms.bedroomsNoBath > 0, patch: (b) => void (b.rooms.bedroomsNoBath = Math.max(0, b.rooms.bedroomsNoBath - 1)) },
  { label: 'One fewer study', applies: (b) => b.rooms.studies > 0, patch: (b) => void (b.rooms.studies = Math.max(0, b.rooms.studies - 1)) },
  { label: 'Leave out the courtyard', applies: (b) => b.rooms.priorities.courtyard, patch: (b) => void (b.rooms.priorities.courtyard = false) },
  { label: 'Leave out the balconies', applies: (b) => b.rooms.balcony, patch: (b) => void (b.rooms.balcony = false) },
  {
    label: 'Share a bathroom instead of one attached bath',
    // never take an attached bath a senior's room needs
    applies: (b) => b.rooms.bedroomsWithBath - 1 >= seniorRooms(b),
    patch: (b) => {
      if (b.rooms.bedroomsWithBath - 1 < seniorRooms(b)) return
      b.rooms.bedroomsWithBath -= 1
      b.rooms.bedroomsNoBath = Math.min(8, b.rooms.bedroomsNoBath + 1)
    },
  },
  { label: 'Leave out the covered verandah', applies: (b) => b.rooms.priorities.coveredVerandah, patch: (b) => void (b.rooms.priorities.coveredVerandah = false) },
  {
    label: 'Budget for construction only (interiors and landscaping later)',
    applies: (b) => b.budget.scope === 'all',
    patch: (b) => void (b.budget.scope = 'construction'),
  },
]

/** expected cost of the brief at target room sizes */
const targetCost = (b: Brief) => areaNeeded(b).targetSqm * costPerSqmAllIn(b)
const headroom = (b: Brief) => maxAffordableSqm(b) - areaNeeded(b).targetSqm

/**
 * Up to three edits that bring the brief within budget, chosen greedily:
 * at each step the single edit that most improves (maxSqm − targetSqm).
 * Each patch assumes the ones before it were applied. Empty when the
 * brief is already comfortable.
 */
export function suggestCuts(brief: Brief): BudgetCut[] {
  const cuts: BudgetCut[] = []
  let current = structuredClone(brief)
  for (let step = 0; step < 3 && assessBudgetFit(current).status !== 'comfortable'; step++) {
    let best: { c: Candidate; next: Brief; gain: number } | null = null
    for (const c of CANDIDATES) {
      if (!c.applies(current)) continue
      const next = structuredClone(current)
      c.patch(next)
      const gain = headroom(next)
      if (!best || gain > best.gain) best = { c, next, gain }
    }
    if (!best || best.gain <= headroom(current)) break
    const label = typeof best.c.label === 'function' ? best.c.label(current) : best.c.label
    cuts.push({ label, patch: best.c.patch, savesLakh: lakh(targetCost(current) - targetCost(best.next)) })
    current = best.next
  }
  return cuts
}
