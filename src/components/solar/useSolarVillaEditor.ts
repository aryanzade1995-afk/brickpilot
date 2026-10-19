import { useMemo, useState } from 'react'
import type { Design } from '@/lib/engine/types.ts'
import { useStudio } from '@/state/studio.ts'
import { solarSignature, type SolarConfiguration, type SolarLayoutV2 } from '@/lib/model/solar.ts'
import { buildSolarRoofModel } from '@/lib/solar/roofModel.ts'
import { reviewSolarLayout } from '@/lib/solar/placement.ts'
import { createSolarLayoutDraft, previewSolarLayoutDraft, type SolarLayoutDraft } from '@/lib/solar/layoutEditing.ts'
import { solarIssueLabel } from '@/lib/solar/editor.ts'
import type { SolarCameraRequest } from '@/lib/three/SolarCamera.tsx'

export const solarArrayId = (p: SolarLayoutV2['panels'][number]) => `${p.roofSurfaceId}|${p.roofComponentId}`
export const solarEditError = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error)
  return ({ SOLAR_EDIT_STALE: 'The project or roof changed. Cancel and reopen the layout editor.',
    KEEP_FREE_OUTSIDE_ROOF: 'Keep-free areas must stay inside a supported roof and clear of openings.',
    KEEP_FREE_BLOCKS_ACCESS: 'This keep-free area blocks roof access. Move or resize it.',
    SOLAR_LAYOUT_REQUIRED: 'Save a valid solar layout in Specifications before moving panels.',
  } as Record<string, string>)[code] ?? 'This edit does not fit. Adjust the draft before applying.'
}
export function useSolarVillaEditor(plan: Design, acceptedSeed?: number) {
  const live = useStudio(s => s.result), commit = useStudio(s => s.commitSolarLayoutEdit)
  const solar = useStudio(s => s.result?.design === plan ? s.brief.solar : plan.model.brief.solar)
  const architecture = useMemo(() => live?.design === plan && live.buildingModel && live.massingModel && live.facadeModel && live.villaDesignDNA && acceptedSeed === live.villaDesignDNA.seed ? {
    buildingModel: live.buildingModel, massingModel: live.massingModel, facadeGrammar: live.facadeModel, villaDesignDNA: live.villaDesignDNA,
  } : undefined, [live, plan, acceptedSeed])
  const saved = solar.calculated?.layout
  const roof = useMemo(() => buildSolarRoofModel(plan, { architecture, inputs: solar.inputs,
    policy: saved?.schemaVersion === 2 ? saved.allocationPolicy : undefined }), [plan, architecture, solar.inputs, saved])
  const layout = useMemo(() => solar.intention === 'install-now' && saved?.schemaVersion === 2 &&
    reviewSolarLayout(saved, solar, roof).state === 'concept-valid' ? saved : null, [solar, saved, roof])
  const [draft, setDraft] = useState<SolarLayoutDraft | null>(null)
  const [preview, setPreview] = useState<ReturnType<typeof previewSolarLayoutDraft> | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [arrayId, selectArray] = useState('all'), [panelId, selectPanel] = useState('all')
  const [camera, setCamera] = useState<SolarCameraRequest>(null)
  const view = (v: NonNullable<SolarCameraRequest>['view']) => setCamera(c => ({ view: v, nonce: (c?.nonce ?? 0) + 1 }))
  const available = Boolean(architecture && roof.surfaces.some(s => s.kind === 'flat-top-roof' && s.access.status === 'modeled'))
  const sourceChanged = !!draft && (draft.baseSolarSignature !== solarSignature(solar) || draft.roofSignature !== roof.roofSignature)
  const sourceLayout = saved?.schemaVersion === 2 ? saved : null
  const displayConfiguration: SolarConfiguration = !sourceChanged && preview?.configuration ? preview.configuration : solar
  const displayLayout = !sourceChanged && preview?.configuration?.calculated?.layout.schemaVersion === 2 ? preview.configuration.calculated.layout : layout
  const displayRoof = !sourceChanged && preview?.configuration ? preview.roof : roof
  const arrays = [...new Set((sourceLayout?.panels ?? []).map(solarArrayId))]
  const selectedIds = useMemo(() => new Set((sourceLayout?.panels ?? []).filter(p =>
    (arrayId === 'all' || solarArrayId(p) === arrayId) && (panelId === 'all' || panelId === p.id)).map(p => p.id)), [sourceLayout, arrayId, panelId])
  const pickPanel = (id: string) => {
    const panel = sourceLayout?.panels.find(p => p.id === id)
    if (panel) { selectArray(solarArrayId(panel)); selectPanel(id) }
  }
  const start = () => { setDraft(createSolarLayoutDraft(solar, roof.roofSignature)); setPreview(null); setError(''); setNotice(''); view('top') }
  const change = (next: SolarLayoutDraft) => { setDraft(next); setPreview(null); setError(''); setNotice('') }
  const cancel = () => { setDraft(null); setPreview(null); setError(''); setNotice('Solar layout draft discarded.'); view('terrace') }
  const check = () => {
    if (!draft) return
    if (sourceChanged) { setError('The project or roof changed. Cancel and reopen the layout editor.'); return }
    try {
      const proposal = previewSolarLayoutDraft(plan, solar, architecture, draft)
      setPreview(proposal)
      setError(proposal.configuration ? '' : proposal.issues.filter(i => !['REQUEST_NOT_MET', 'CONSERVATIVE_SEARCH'].includes(i.code)).map(i => solarIssueLabel(i.code))[0] || 'This edit does not fit. Adjust the draft before applying.')
    } catch (e) { setPreview(null); setError(solarEditError(e)) }
  }
  const apply = () => {
    if (!draft || !preview?.configuration || sourceChanged) return
    const outcome = commit(preview.configuration, draft.baseSolarSignature, draft.roofSignature)
    if (!outcome.ok) { setError(solarEditError(outcome.error)); setPreview(null); return }
    setDraft(null); setPreview(null); setError(''); setNotice('Solar layout saved.'); view('terrace')
  }
  return { solar, roof, layout, sourceLayout, draft, preview, error, notice, sourceChanged, available, arrays,
    arrayId, panelId, selectedIds, selectArray: (id: string) => { selectArray(id); selectPanel('all') }, selectPanel, pickPanel,
    start, change, cancel, check, apply, camera, view, displayLayout, displayRoof, displayConfiguration }
}
export type SolarVillaEditor = ReturnType<typeof useSolarVillaEditor>
