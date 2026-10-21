import { useEffect, useRef, useState } from 'react'
import type { UtilityFloor } from '@/lib/utilities/plan.ts'
import { defaultDrawing, settingsSchema, sourceSignature, uid, type DrawingDocument, type UtilityDrawingProject } from '@/lib/utilities/drawingProject.ts'

type State = { document: DrawingDocument; imported: { project: UtilityDrawingProject; token: string } | null }
export function useUtilityDrawing(model: UtilityFloor, project: string, scope: string) {
  const [state, setState] = useState<State>(() => {
    const document = defaultDrawing(project)
    try { const saved = settingsSchema.safeParse(JSON.parse(localStorage.getItem(`formstead.utility-sheet-settings.v1:${scope}`) ?? 'null')); if (saved.success) document.settings = saved.data } catch { /* Work without persistent storage. */ }
    return { document, imported: null }
  })
  const [past, setPast] = useState<State[]>([]), [future, setFuture] = useState<State[]>([]), last = useRef(state)
  last.current = state
  const signature = sourceSignature(model), original = useRef(signature)
  useEffect(() => { try { localStorage.setItem(`formstead.utility-sheet-settings.v1:${scope}`, JSON.stringify(state.document.settings)) } catch { /* Full session autosave exposes storage errors to the user. */ } }, [state.document.settings, scope])
  const commit = (next: State) => { setPast(p => [...p.slice(-49), last.current]); setFuture([]); setState(next) }
  const change = (edit: (doc: DrawingDocument) => void) => { const document = structuredClone(last.current.document); edit(document); if (JSON.stringify(document) !== JSON.stringify(last.current.document)) commit({ ...last.current, document }) }
  const load = (project: UtilityDrawingProject) => commit({ document: project.document, imported: { project, token: uid() } })
  const undo = () => { const before = past.at(-1); if (before) { setFuture(f => [...f, last.current]); setPast(p => p.slice(0, -1)); setState(before) } }
  const redo = () => { const after = future.at(-1); if (after) { setPast(p => [...p, last.current]); setFuture(f => f.slice(0, -1)); setState(after) } }
  return { document: state.document, model: state.imported?.project.model ?? model, imported: state.imported, initialReviews: state.imported?.project.reviews,
    reviewScope: state.imported ? `${scope}:drawing:${state.imported.project.sourceSignature}:${state.imported.token}` : scope,
    sourceChanged: !state.imported && original.current !== signature, change, load, undo, redo, canUndo: !!past.length, canRedo: !!future.length,
    returnToLive: () => commit({ document: defaultDrawing(project), imported: null }) }
}
