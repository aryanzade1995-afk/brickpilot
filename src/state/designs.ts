import { snapshotCost, parseCostReplay, restoreCostReplay, type CostReplay } from '@/lib/cost/replay.ts'
import { estimateProjectBoq } from '@/lib/cost/index.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { useFinishes } from '@/state/finishes.ts'
import { create } from 'zustand'
import { supabase } from '@/lib/supabase.ts'
import { briefSchema, type Brief } from '@/lib/model/brief.ts'
import { useStudio, parsePinned, serializePinned, type PinnedDir } from '@/state/studio.ts'
import { useAuth } from '@/state/auth.ts'
import { parseLayout } from '@/lib/plan/parse.ts'
import type { LayoutDoc } from '@/lib/plan/layout.ts'

/* ------------------------------------------------------------------ *
 *  Saved designs — one row per project in Supabase `public.designs`,
 *  RLS-scoped to the owner. A project is fully defined by its brief +
 *  pinned direction; the deterministic engine rebuilds everything else.
 * ------------------------------------------------------------------ */

export type SavedDesign = {
  id: string
  name: string
  brief: Brief
  pinned: PinnedDir | null
  costReplay: CostReplay | null
  /** the room-by-room edits made to the pinned plan */
  layout: LayoutDoc | null
  createdAt: string
  updatedAt: string
}

export function parseSavedDesignRow(row: {
  id: string
  name: string
  brief: unknown
  pinned: string | null
  created_at: string
  updated_at: string
}): SavedDesign | null {
  const brief = briefSchema.safeParse(row.brief)
  if (!brief.success) return null
  let savedCost: unknown, savedLayout: unknown
  if (row.pinned?.startsWith('{')) { try { const j = JSON.parse(row.pinned); savedCost = j.costReplay; savedLayout = j.planLayout } catch { /* Legacy pin. */ } }
  return {
    costReplay: parseCostReplay(savedCost),
    layout: parseLayout(savedLayout),
    id: row.id,
    name: row.name,
    brief: brief.data,
    pinned: parsePinned(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type DesignsState = {
  items: SavedDesign[]
  loading: boolean
  error: string | null
  /** id of the design the working project was loaded from / last saved as */
  currentId: string | null

  fetch: () => Promise<void>
  saveCurrent: (name?: string) => Promise<{ error?: string; id?: string }>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  /** apply a saved design to the working studio state; returns it for routing */
  load: (id: string) => SavedDesign | null
  clearLocal: () => void
}

export const useDesigns = create<DesignsState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  currentId: null,

  fetch: async () => {
    if (!supabase || !useAuth.getState().user) {
      set({ items: [], error: null })
      return
    }
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('designs')
      .select('id,name,brief,pinned,created_at,updated_at')
      .order('updated_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ loading: false, items: (data ?? []).map(parseSavedDesignRow).filter((d): d is SavedDesign => d !== null) })
  },

  saveCurrent: async (name) => {
    const user = useAuth.getState().user
    if (!supabase || !user) return { error: 'Sign in to save a design.' }

    const { brief, pinned, result, layout } = useStudio.getState()
    const savedSelection = result ? useFinishes.getState().entries[geometryCostKey(result.design)] : undefined
    const replay = result?.report.hardChecksPass ? snapshotCost(result.design, brief, estimateProjectBoq(result.design, brief, savedSelection)) : null
    const { currentId } = get()
    const payload = {
      user_id: user.id,
      name: (name ?? brief.project.name ?? 'Untitled design').trim() || 'Untitled design',
      brief,
      pinned: replay || layout ? JSON.stringify({ ...pinned, ...(replay ? { costReplay: replay } : {}), ...(layout ? { planLayout: layout } : {}) }) : serializePinned(pinned),
    }

    const q = currentId
      ? supabase.from('designs').update(payload).eq('id', currentId).select('id,name,brief,pinned,created_at,updated_at').single()
      : supabase.from('designs').insert(payload).select('id,name,brief,pinned,created_at,updated_at').single()

    const { data, error } = await q
    if (error || !data) return { error: error?.message ?? 'save failed' }

    const saved = parseSavedDesignRow(data)
    set((s) => ({
      currentId: data.id,
      items: [
        ...(saved ? [saved] : []),
        ...s.items.filter((d) => d.id !== data.id),
      ],
    }))
    return { id: data.id }
  },

  rename: async (id, name) => {
    if (!supabase) return
    const trimmed = name.trim() || 'Untitled design'
    set((s) => ({ items: s.items.map((d) => (d.id === id ? { ...d, name: trimmed } : d)) }))
    await supabase.from('designs').update({ name: trimmed }).eq('id', id)
  },

  remove: async (id) => {
    if (!supabase) return
    set((s) => ({
      items: s.items.filter((d) => d.id !== id),
      currentId: s.currentId === id ? null : s.currentId,
    }))
    await supabase.from('designs').delete().eq('id', id)
  },

  load: (id) => {
    const design = get().items.find((d) => d.id === id)
    if (!design) return null
    restoreCostReplay(design.costReplay)
    if (design.costReplay) useFinishes.getState().setSelection(design.costReplay.geometryKey, design.costReplay.cost.selection)
    useStudio.getState().loadSaved(design.brief, design.pinned, design.layout)
    set({ currentId: id })
    return design
  },

  clearLocal: () => { restoreCostReplay(null); set({ items: [], currentId: null, error: null }) },
}))
