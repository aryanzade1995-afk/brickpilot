import { publishDrainage } from '@/lib/utilities/sharedDrainage.ts'
import { planningSchema } from '@/lib/utilities/planning.ts'
import { useEffect, useRef, useState } from 'react'
import type { UtilityFloor } from '@/lib/utilities/plan.ts'
import { defaultDrawing, settingsSchema, sourceSignature, uid, type DrawingDocument, type UtilityDrawingProject } from '@/lib/utilities/drawingProject.ts'
import { electricalInputsSchema } from '@/lib/utilities/electricalInputs.ts'
import { drainageInputsSchema } from '@/lib/utilities/drainageInputs.ts'

type State = { document: DrawingDocument; imported: { project: UtilityDrawingProject; token: string } | null }
export function useUtilityDrawing(model: UtilityFloor, project: string, scope: string, initialDrainageVisible=false, initialWaterVisible=false) {
  const [state, setState] = useState<State>(() => {
    const document = defaultDrawing(project)
    if(initialDrainageVisible)document.layers.drainage.visible=true
    if(initialWaterVisible)document.layers.water_supply.visible=true
    try { const saved = settingsSchema.safeParse(JSON.parse(localStorage.getItem(`formstead.utility-sheet-settings.v1:${scope}`) ?? 'null')); if (saved.success) document.settings = saved.data } catch { /* Work without persistent storage. */ }
    try { const saved = drainageInputsSchema.safeParse(JSON.parse(localStorage.getItem(`formstead.drainage-inputs.v1:${scope}`) ?? 'null')); if (saved.success) document.drainage = saved.data } catch { /* Unknown inputs remain unknown. */ }
    try { const saved = electricalInputsSchema.safeParse(JSON.parse(localStorage.getItem(`formstead.electrical-inputs.v1:${scope}`) ?? 'null')); if (saved.success) document.electrical = saved.data } catch { /* Keep inputs unknown. */ }
    try { const saved = planningSchema.safeParse(JSON.parse(localStorage.getItem(`formstead.utility-points.v1:${scope}`) ?? 'null')); if (saved.success) document.planning = saved.data } catch { /* Manual edits remain available without storage. */ }
    return { document, imported: null }
  })
  const [past, setPast] = useState<State[]>([]), [future, setFuture] = useState<State[]>([]), last = useRef(state), liveDocument = useRef(state.document)
  last.current = state
  const signature = sourceSignature(model), original = useRef(signature)
  useEffect(() => { try { localStorage.setItem(`formstead.utility-sheet-settings.v1:${scope}`, JSON.stringify(state.document.settings)) } catch { /* Full session autosave exposes storage errors to the user. */ } }, [state.document.settings, scope])
  useEffect(() => { if (!state.imported) try { localStorage.setItem(`formstead.drainage-inputs.v1:${scope}`, JSON.stringify(state.document.drainage)) } catch { /* Full JSON save remains available. */ } }, [state.document.drainage, state.imported, scope])
  useEffect(() => { if (!state.imported) try { localStorage.setItem(`formstead.electrical-inputs.v1:${scope}`, JSON.stringify(state.document.electrical)) } catch { /* JSON save remains available. */ } }, [state.document.electrical, state.imported, scope])
  useEffect(() => { if (!state.imported) try { localStorage.setItem(`formstead.utility-points.v1:${scope}`, JSON.stringify(state.document.planning)) } catch { /* Full JSON save remains available. */ } }, [state.document.planning, state.imported, scope])
  useEffect(() => { publishDrainage(scope, state.imported?.project.model ?? model, state.document.drainage, state.document.planning) }, [scope, model, state.imported, state.document.drainage, state.document.planning])
  const commit = (next: State) => { setPast(p => [...p.slice(-49), last.current]); setFuture([]); setState(next) }
  const change = (edit: (doc: DrawingDocument) => void) => { const document = structuredClone(last.current.document); edit(document); if (JSON.stringify(document) !== JSON.stringify(last.current.document)) { commit({ ...last.current, document }); return true } return false }
  const load = (project: UtilityDrawingProject) => { if (!last.current.imported) liveDocument.current = last.current.document; commit({ document: project.document, imported: { project, token: uid() } }) }
  const undo = () => { const before = past.at(-1); if (before) { setFuture(f => [...f, last.current]); setPast(p => p.slice(0, -1)); setState(before) } }
  const redo = () => { const after = future.at(-1); if (after) { setPast(p => [...p, last.current]); setFuture(f => f.slice(0, -1)); setState(after) } }
  return { document: state.document, model: state.imported?.project.model ?? model, imported: state.imported, initialReviews: state.imported?.project.reviews,
    reviewScope: state.imported ? `${scope}:drawing:${state.imported.project.sourceSignature}:${state.imported.token}` : scope,
    sourceChanged: !state.imported && original.current !== signature, change, load, undo, redo, canUndo: !!past.length, canRedo: !!future.length,
    returnToLive: () => commit({ document: liveDocument.current, imported: null }) }
}
