import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStudio, type Result } from '@/state/studio.ts'
import { useFinishes } from '@/state/finishes.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { estimateProjectBoq } from '@/lib/cost/index.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { parseSelection } from '@/lib/cost/specifications.ts'
import { cx } from '@/lib/cx.ts'
import type { Brief } from '@/lib/model/brief.ts'
import { selectionFromBrief, writeSelectionToBrief } from '@/lib/cost/briefSelections.ts'
import { COST_TABS, costTabId, quantitySignature } from '@/lib/cost/workspace.ts'
import { Specifications } from './finishes/Specifications.tsx'
import { QuantitiesView, EstimateView, AssumptionsView } from './finishes/CostViews.tsx'

export function FinishesCost() {
  const result = useStudio(s => s.result), run = useStudio(s => s.run)
  const brief = useStudio(s => s.brief), edit = useStudio(s => s.edit)
  useEffect(() => { if (!result) run() }, [result, run])
  return <FinishesCostView result={result} brief={brief} onBrief={next => edit(b => { b.finish = next.finish; b.specs = next.specs })} />
}
export function FinishesCostView({ result, brief, onBrief }: { result: Pick<Result, 'design' | 'report'> | null; brief?: Brief; onBrief?: (brief: Brief) => void }) {
  const [localBrief, setLocal] = useState<Brief | null>(null), [params, setParams] = useSearchParams()
  const key = useMemo(() => result ? geometryCostKey(result.design) : '', [result])
  const saved = useFinishes(s => s.entries[key]), setSelection = useFinishes(s => s.setSelection)
  const noteQuantities = useFinishes(s => s.noteQuantities), updated = useFinishes(s => s.quantitiesUpdated)
  const current = useMemo(() => {
    const source = brief ?? localBrief ?? result?.design.model.brief
    if (!source || !result) return null
    if (!saved || saved.catalogue || source.finish !== 'mid' || Object.keys(source.specs.overrides).length) return source
    const migrated = { ...source, specs: { overrides: { ...source.specs.overrides } } }
    writeSelectionToBrief(migrated, result.design, saved)
    return migrated
  }, [brief, localBrief, result, saved])
  const cost = useMemo(() => result && current ? estimateProjectBoq(result.design, current, saved) : null, [result, current, saved])
  useEffect(() => { if (cost && result?.report.hardChecksPass) noteQuantities(quantitySignature(cost)) }, [cost, result, noteQuantities])
  const update = (next: Brief) => {
    if (!result) return
    // Keep browser-only allowance settings while saving the full catalogue in the Brief.
    setSelection(key, selectionFromBrief(next, result.design, saved, false))
    setLocal(next); onBrief?.(next)
  }
  const tab = COST_TABS.find(t => costTabId(t) === params.get('tab')) ?? 'Specifications'
  const room = cost?.quantities.rooms.some(r => r.id === params.get('room')) ? params.get('room')! : undefined
  const setTab = (label: string) => { const next = new URLSearchParams(params); next.set('tab', costTabId(label)); setParams(next) }
  if (!result || !cost || !current) return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10"><WorkspaceTabs /><p className="mt-8 text-sm text-ink-dim">Preparing your estimate…</p></div>
  if (!result.report.hardChecksPass) return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10"><WorkspaceTabs /><h1 className="mt-8 font-display text-2xl">Finishes & Cost</h1><p className="mt-3 text-sm text-ink-dim">Choose a valid floor plan first. We’ll measure it and prepare the estimate here.</p><Link to="/workspace" className="mt-5 inline-block text-sm underline">Review your brief</Link></div>
  return <div className="mx-auto max-w-[1400px] px-5 py-8 md:px-10"><WorkspaceTabs />
    <header className="mt-6"><p className="label">Step 06 · Finishes & Cost</p><h1 className="mt-2 font-display text-3xl">The finishes for your home</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-dim">Choose finishes at your own pace. Quantities come from your plan; your estimate updates as you choose.</p><p className="mt-3 text-xs text-ink-faint">{cost.label}</p>{updated && <p role="status" className="mt-2 text-xs text-ink-dim">Updated after plan change</p>}</header>
    <nav aria-label="Finishes & Cost sub-tabs" className="mt-6 flex gap-1 overflow-x-auto border-b border-line pb-px">{COST_TABS.map((label, i) => <button type="button" key={label} aria-current={tab === label ? 'page' : undefined} onClick={() => setTab(label)} className={cx('flex flex-none items-center gap-2 border-b-2 px-3 py-2.5 font-mono text-[0.7rem] uppercase tracking-[0.1em]', tab === label ? 'border-accent text-accent' : 'border-transparent text-ink-faint hover:text-ink')}><span>06.{i + 1}</span>{label}</button>)}</nav>
    <div className="mt-7">{tab === 'Specifications' ? <Specifications brief={current} cost={cost} design={result.design} room={room} onRoom={id => { const next = new URLSearchParams(params); if (id) next.set('room', id); else next.delete('room'); setParams(next) }} onBrief={update} /> : tab === 'Quantities' ? <QuantitiesView cost={cost} /> : tab === 'Estimate' ? <EstimateView cost={cost} onAllowances={change => setSelection(key, parseSelection({ ...cost.selection, ...change }))} /> : <AssumptionsView cost={cost} />}</div>
    <footer className="mt-10 flex flex-wrap justify-between gap-4 border-t border-line pt-5 text-sm"><Link to="/workspace/render" className="text-ink-dim underline">Back to Render</Link><Link to="/workspace/report" className="underline">Continue to Report →</Link></footer>
  </div>
}
