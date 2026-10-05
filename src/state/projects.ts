import { create } from 'zustand'
import { briefSchema, type Brief } from '@/lib/model/brief.ts'
import type { LayoutDoc } from '@/lib/plan/layout.ts'
import { parseLayout } from '@/lib/plan/parse.ts'
import type { ExistingStructure } from '@/lib/engine/planner/types.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { useFinishes } from '@/state/finishes.ts'
import { parsePinned, serializePinned, useStudio, type PinnedDir } from '@/state/studio.ts'
import { restoreCostReplay } from '@/lib/cost/replay.ts'

/* ------------------------------------------------------------------ *
 *  Projects saved on this device. A project is the brief, the pinned
 *  direction, the room-by-room layout and the locked structure; the
 *  deterministic engine rebuilds the 2D plan, the 3D villa and the cost
 *  from them. A readable summary is stored beside it so a project can be
 *  listed (and drawn) without rebuilding anything.
 * ------------------------------------------------------------------ */

export const STAGES = [
  { id: 'concept', label: 'Concept', hint: 'Still deciding' },
  { id: 'design', label: 'Design development', hint: 'Plan being refined' },
  { id: 'approvals', label: 'Drawings & approvals', hint: 'Sanction drawings' },
  { id: 'foundation', label: 'Foundation', hint: 'Excavation and footings' },
  { id: 'structure', label: 'Structure', hint: 'Columns, beams and slabs' },
  { id: 'finishing', label: 'Finishing', hint: 'Walls, floors, services' },
  { id: 'handover', label: 'Handover', hint: 'Complete' },
] as const
export type StageId = (typeof STAGES)[number]['id']
export const stageLabel = (id: StageId) => STAGES.find((s) => s.id === id)?.label ?? id

/** everything that rebuilds the design */
export type Core = {
  brief: Brief
  pinned: string | null
  layout: LayoutDoc | null
  existing: { structure: ExistingStructure; seed: number } | null
  finishes: { key: string; selection: unknown } | null
  stage: StageId
}

export type RoomSummary = { id: string; name: string; type: string; x: number; y: number; w: number; h: number; areaSqm: number; locked: boolean }
export type Summary = {
  plot: { widthM: number; depthM: number }
  storeys: number
  builtAreaSqm: number
  heightM: number
  character: string
  /** the 3D design: massing archetype and the seeds that define it */
  design: { massing: string; planSeed: number | null; seed: number | null; family: string | null; architecturalFamily: string | null; roof: string | null } | null
  floors: { level: number; name: string; rooms: RoomSummary[] }[]
  /** ids of rooms (and built columns) that must not change */
  locked: string[]
  edited: boolean
}

export type Version = { id: string; at: string; label: string; core: Core }
export type Project = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** created by auto-save rather than by the person pressing Save */
  draft: boolean
  core: Core
  summary: Summary | null
  versions: Version[]
}

const KEY = 'brickpilot.projects.v1'
const MAX_VERSIONS = 20
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)

/* ------------------------------ snapshot <-> studio ----------------------------- */

export function summarise(): Summary | null {
  const { result, brief, layout, existing, pinned } = useStudio.getState()
  if (!result) return null
  const d = result.design
  const types = new Map<string, string>()
  for (const f of layout?.floors ?? []) for (const r of f.rooms) types.set(`${f.level}:${r.id}`, r.type)
  const locked = [
    ...(layout?.floors.flatMap((f) => f.rooms.filter((r) => r.locked).map((r) => `${f.level}:${r.id}`)) ?? []),
    ...(existing ? [...existing.structure.columns.map((c) => c.id), ...existing.structure.footings.map((c) => c.id)] : []),
  ]
  return {
    plot: { widthM: brief.site.plotWidth, depthM: brief.site.plotDepth },
    storeys: brief.levels.storeys,
    builtAreaSqm: d.builtAreaSqm,
    heightM: d.heightM,
    character: brief.style.character,
    design: pinned || d ? { massing: d.massingType, planSeed: d.planSeed ?? null, seed: d.dna.seed ?? null, family: d.planFamily ?? null,
      architecturalFamily: result.villaDesignDNA?.architecturalFamily ?? null, roof: d.floors.at(-1)?.roof.kind ?? null } : null,
    floors: d.floors.map((f) => ({
      level: f.level, name: f.name,
      rooms: f.rooms.filter((r) => !r.outdoor).map((r) => ({ id: r.id, name: r.name, type: types.get(`${f.level}:${r.id}`) ?? r.zone,
        x: r.rect.x, y: r.rect.y, w: r.rect.w, h: r.rect.h, areaSqm: r.area, locked: locked.includes(`${f.level}:${r.id}`) })),
    })),
    locked,
    edited: !!layout,
  }
}

function currentCore(stage: StageId): Core {
  const { brief, pinned, layout, existing, result } = useStudio.getState()
  const key = result ? geometryCostKey(result.design) : null
  const selection = key ? useFinishes.getState().entries[key] : undefined
  return { brief: structuredClone(brief), pinned: serializePinned(pinned), layout: layout ? structuredClone(layout) : null,
    existing: existing ? structuredClone(existing) : null, finishes: key && selection ? { key, selection: structuredClone(selection) } : null, stage }
}

/** read a stored core back defensively; null when it is no longer usable */
export function parseCore(value: unknown): Core | null {
  const v = value as Partial<Core> | null
  if (!v || typeof v !== 'object') return null
  const brief = briefSchema.safeParse(v.brief)
  if (!brief.success) return null
  const stage = STAGES.some((s) => s.id === v.stage) ? (v.stage as StageId) : 'concept'
  const ex = v.existing as Core['existing']
  const existing = ex && ex.structure && Array.isArray(ex.structure.columns) && Array.isArray(ex.structure.footings) && Array.isArray(ex.structure.beams) && Array.isArray(ex.structure.walls) ? ex : null
  const fin = v.finishes as Core['finishes']
  return { brief: brief.data, pinned: typeof v.pinned === 'string' ? v.pinned : null, layout: parseLayout(v.layout), existing,
    finishes: fin && typeof fin.key === 'string' ? fin : null, stage }
}

const parseProject = (v: unknown): Project | null => {
  const p = v as Partial<Project> | null
  if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') return null
  const core = parseCore(p.core)
  if (!core) return null
  const versions = Array.isArray(p.versions) ? p.versions.flatMap((x): Version[] => {
    const c = parseCore((x as Version)?.core)
    return c && typeof (x as Version).id === 'string' ? [{ id: (x as Version).id, at: String((x as Version).at), label: String((x as Version).label ?? ''), core: c }] : []
  }) : []
  return { id: p.id, name: p.name, createdAt: String(p.createdAt ?? new Date().toISOString()), updatedAt: String(p.updatedAt ?? new Date().toISOString()),
    draft: p.draft === true, core, summary: (p.summary as Summary) ?? null, versions }
}

function load(): { items: Project[]; currentId: string | null } {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as { items?: unknown[]; currentId?: unknown } | null
    const items = (raw?.items ?? []).map(parseProject).filter((p): p is Project => p !== null)
    const currentId = typeof raw?.currentId === 'string' && items.some((p) => p.id === raw.currentId) ? raw.currentId : null
    return { items, currentId }
  } catch { return { items: [], currentId: null } }
}

/** write to storage; on a full disk drop the oldest versions first, then fail loudly */
function persist(items: Project[], currentId: string | null): string | null {
  const write = (list: Project[]) => globalThis.localStorage?.setItem(KEY, JSON.stringify({ items: list, currentId }))
  try { write(items); return null } catch { /* fall through and trim */ }
  let list = items
  for (let keep = 10; keep >= 0; keep -= 5) {
    list = list.map((p) => ({ ...p, versions: p.versions.slice(0, keep) }))
    try { write(list); return null } catch { /* keep trimming */ }
  }
  return 'This device has no room left to save. Delete a project you no longer need.'
}

/** put a stored core into the working studio */
export function applyCore(core: Core): void {
  restoreCostReplay(null)
  const pinned: PinnedDir | null = parsePinned(core.pinned)
  useStudio.getState().loadSaved(core.brief, pinned, core.layout, core.existing)
  if (core.finishes) useFinishes.getState().setSelection(core.finishes.key, core.finishes.selection)
}

type ProjectsState = {
  items: Project[]
  currentId: string | null
  /** the construction stage of the project being worked on (kept even before the first save) */
  stage: StageId
  lastSavedAt: string | null
  error: string | null
  setStage: (stage: StageId, id?: string) => void
  /** the person presses Save: names it, makes a version, clears the draft flag */
  save: (opts?: { name?: string; label?: string }) => Project | null
  /** quiet save after a major change; only once a design exists */
  autoSave: (label?: string) => void
  open: (id: string) => Project | null
  rename: (id: string, name: string) => void
  duplicate: (id: string) => string | null
  remove: (id: string) => void
  restore: (id: string, versionId: string) => boolean
  startNew: () => void
}

const initial = load()

export const useProjects = create<ProjectsState>((set, get) => {
  const commit = (items: Project[], currentId: string | null) => { const error = persist(items, currentId); set({ items, currentId, error, lastSavedAt: error ? get().lastSavedAt : new Date().toISOString() }) }
  const withVersion = (p: Project, core: Core, label: string, coalesce: boolean): Version[] => {
    const now = new Date()
    const last = p.versions[0]
    if (coalesce && last && last.label.startsWith('Auto-saved') && now.getTime() - new Date(last.at).getTime() < 120_000)
      return [{ ...last, at: now.toISOString(), core }, ...p.versions.slice(1)]
    return [{ id: uid(), at: now.toISOString(), label, core }, ...p.versions].slice(0, MAX_VERSIONS)
  }
  return {
    items: initial.items,
    currentId: initial.currentId,
    stage: initial.items.find((p) => p.id === initial.currentId)?.core.stage ?? 'concept',
    lastSavedAt: null,
    error: null,

    setStage: (stage, id) => {
      const target = id ?? get().currentId
      set({ stage: id && id !== get().currentId ? get().stage : stage })
      if (!target) return
      commit(get().items.map((p) => (p.id === target ? { ...p, updatedAt: new Date().toISOString(), core: { ...p.core, stage }, versions: withVersion(p, { ...p.core, stage }, `Stage: ${stageLabel(stage)}`, false) } : p)), get().currentId)
    },

    save: (opts) => {
      const st = useStudio.getState()
      if (!st.result) return null
      const core = currentCore(get().stage)
      const summary = summarise()
      const now = new Date().toISOString()
      const { items, currentId } = get()
      const existing = items.find((p) => p.id === currentId)
      const name = (opts?.name ?? existing?.name ?? st.brief.project.name ?? '').trim() || 'Untitled villa'
      if (existing) {
        const next: Project = { ...existing, name, draft: false, updatedAt: now, core, summary, versions: withVersion(existing, core, opts?.label ?? 'Saved', false) }
        commit(items.map((p) => (p.id === existing.id ? next : p)), existing.id)
        return next
      }
      const created: Project = { id: uid(), name, createdAt: now, updatedAt: now, draft: false, core, summary, versions: [{ id: uid(), at: now, label: opts?.label ?? 'Saved', core }] }
      commit([created, ...items], created.id)
      return created
    },

    autoSave: (label) => {
      const st = useStudio.getState()
      // nothing to keep until a direction has been chosen or a structure photographed
      if (!st.result || !(st.pinned || st.existing)) return
      const core = currentCore(get().stage)
      const summary = summarise()
      const now = new Date().toISOString()
      const { items, currentId } = get()
      const existing = items.find((p) => p.id === currentId)
      if (existing) {
        if (JSON.stringify(existing.core) === JSON.stringify(core)) return
        const tag = label ? label : 'Auto-saved'
        const next: Project = { ...existing, updatedAt: now, core, summary, versions: withVersion(existing, core, tag, !label) }
        commit(items.map((p) => (p.id === existing.id ? next : p)), existing.id)
        return
      }
      const created: Project = { id: uid(), name: (st.brief.project.name ?? '').trim() || 'Untitled villa', createdAt: now, updatedAt: now, draft: true, core, summary,
        versions: [{ id: uid(), at: now, label: 'Auto-saved', core }] }
      commit([created, ...items], created.id)
    },

    open: (id) => {
      const p = get().items.find((x) => x.id === id)
      if (!p) return null
      applyCore(p.core)
      set({ currentId: id, stage: p.core.stage })
      persist(get().items, id)
      return p
    },

    rename: (id, name) => commit(get().items.map((p) => (p.id === id ? { ...p, name: name.trim() || 'Untitled villa', updatedAt: new Date().toISOString(), draft: false } : p)), get().currentId),

    duplicate: (id) => {
      const p = get().items.find((x) => x.id === id)
      if (!p) return null
      const now = new Date().toISOString()
      const copy: Project = { ...structuredClone(p), id: uid(), name: `${p.name} (copy)`, createdAt: now, updatedAt: now, draft: false,
        versions: [{ id: uid(), at: now, label: `Copied from ${p.name}`, core: structuredClone(p.core) }] }
      commit([copy, ...get().items], get().currentId)
      return copy.id
    },

    remove: (id) => commit(get().items.filter((p) => p.id !== id), get().currentId === id ? null : get().currentId),

    restore: (id, versionId) => {
      const p = get().items.find((x) => x.id === id)
      const v = p?.versions.find((x) => x.id === versionId)
      if (!p || !v) return false
      // the state being replaced is kept, so a restore can itself be undone
      const before: Version = { id: uid(), at: new Date().toISOString(), label: 'Before restore', core: p.core }
      const next: Project = { ...p, core: v.core, updatedAt: new Date().toISOString(), versions: [before, ...p.versions].slice(0, MAX_VERSIONS) }
      applyCore(v.core)
      useStudio.getState().run()
      set({ stage: v.core.stage })
      commit(get().items.map((x) => (x.id === id ? { ...next, summary: summarise() ?? next.summary } : x)), id)
      return true
    },

    startNew: () => set({ currentId: null, stage: 'concept' }),
  }
})

/** keep the open project saved after every major change: a new direction, a plan edit, a brief change, a locked structure */
let timer: ReturnType<typeof setTimeout> | undefined
let pendingLabel: string | undefined
export function noteChange(label: string) { pendingLabel = label }
export function startAutosave(): () => void {
  let last = ''
  const sign = () => { const s = useStudio.getState(); return JSON.stringify([s.pinned, s.layout, s.existing, s.brief.site, s.brief.rooms, s.brief.levels, s.brief.style, s.brief.project.name]) }
  last = sign()
  const unsub = useStudio.subscribe(() => {
    const now = sign()
    if (now === last) return
    last = now
    clearTimeout(timer)
    timer = setTimeout(() => { const label = pendingLabel; pendingLabel = undefined; useProjects.getState().autoSave(label) }, 1500)
  })
  return () => { clearTimeout(timer); unsub() }
}
