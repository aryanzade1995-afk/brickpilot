import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStudio, type Result } from '@/state/studio.ts'
import { useFinishes } from '@/state/finishes.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { CostSummary, BoqTable } from '@/components/CostSummary.tsx'
import { Field } from '@/components/ui/controls.tsx'
import { estimateCost, boqCsv } from '@/lib/cost/index.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { catalog, defaultSelection, finishOption, parseSelection, policy, type FinishCategory } from '@/lib/cost/specifications.ts'
import { cx } from '@/lib/cx.ts'
import type { Brief } from '@/lib/model/brief.ts'
import { selectionFromBrief, writeSelectionToBrief } from '@/lib/cost/briefSelections.ts'
import type { CostSelection } from '@/lib/cost/specifications.ts'

export function FinishesCost() {
  const result = useStudio(s => s.result), run = useStudio(s => s.run)
  const brief = useStudio(s => s.brief), edit = useStudio(s => s.edit)
  useEffect(() => { if (!result) run() }, [result, run])
  return <FinishesCostView result={result} brief={brief} onSelection={selection => {
    if (result) edit(b => writeSelectionToBrief(b, result.design, selection))
  }} />
}
export function FinishesCostView({ result, brief, onSelection }: { result: Pick<Result, 'design' | 'report'> | null; brief?: Brief; onSelection?: (selection: CostSelection) => void }) {
  const key = useMemo(() => result ? geometryCostKey(result.design) : '', [result])
  const saved = useFinishes(s => s.entries[key]), setSelection = useFinishes(s => s.setSelection)
  const selection = useMemo(() => result ? selectionFromBrief(brief ?? result.design.model.brief, result.design, saved) : parseSelection(saved), [saved, brief, result])
  const matchingPreset = catalog.presets.find(p => Object.entries(p.choices).every(([category, id]) => selection.choices[category as FinishCategory] === id) && !Object.keys(selection.roomFloors).length)?.id
  const cost = useMemo(() => result ? estimateCost(result.design, selection) : null, [result, selection])
  const update = (change: Partial<typeof selection>) => {
    const next = parseSelection({ ...selection, ...change })
    setSelection(key, next); onSelection?.(next)
  }
  const download = () => {
    if (!cost) return
    const url = URL.createObjectURL(new Blob(['\uFEFF', boqCsv(cost)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'formstead-concept-boq.csv'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }
  if (!result || !cost) return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10"><WorkspaceTabs /><p className="mt-8 text-sm text-ink-dim">Preparing your estimate…</p></div>
  if (!result.report.hardChecksPass) return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10"><WorkspaceTabs />
    <h1 className="mt-8 font-display text-2xl">Finishes & Cost</h1><p className="mt-3 text-sm text-ink-dim">Choose a valid floor plan first. We’ll measure it and prepare the estimate here.</p>
    <Link to="/workspace" className="mt-5 inline-block text-sm underline">Review your brief</Link></div>
  return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
    <WorkspaceTabs /><div className="mt-6"><p className="label">Step 6 · Finishes & Cost</p>
      <h1 className="mt-2 font-display text-3xl">Choose the finishes for your home</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-dim">Start with Standard, or choose another finish level. Your estimate updates as you choose. Your rooms and design stay the same.</p></div>
    <div className="mt-8 grid items-start gap-10 lg:grid-cols-[1fr_420px]">
      <div className="min-w-0">
        <div role="group" aria-label="Finish level" className="grid gap-3 sm:grid-cols-3">
          {catalog.presets.map(p => <button type="button" key={p.id} aria-pressed={matchingPreset === p.id} onClick={() => update({ preset: p.id, choices: defaultSelection(p.id).choices, roomFloors: {} })}
            className={cx('border p-4 text-left', matchingPreset === p.id ? 'border-ink bg-bg-inset' : 'border-line hover:border-ink-dim')}>
            <span className="font-display text-xl">{p.label}</span><span className="mt-2 block text-xs leading-relaxed text-ink-dim">{p.description}</span></button>)}
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">{catalog.categories.map(group => {
          const category = group.id as FinishCategory, option = finishOption(category, selection.choices[category])
          return <Field key={category} label={group.label} hint={option.description}>
            <select aria-label={group.label} value={option.id} onChange={e => update({ choices: { ...selection.choices, [category]: e.target.value } })}
              className="w-full border border-line-strong bg-bg px-3 py-2.5 text-sm">
              {group.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select></Field>
        })}</div>
        <details className="mt-8 border-t border-line pt-5"><summary className="cursor-pointer text-sm">Room-by-room flooring</summary>
          <p className="mt-3 text-xs text-ink-dim">All indoor rooms use your flooring choice unless you change one below.</p>
          <div className="mt-4 space-y-3">{cost.quantities.rooms.map(room => <div key={room.id} className="grid items-center gap-2 sm:grid-cols-2">
            <label htmlFor={`finish-${room.id}`} className="text-sm">{room.floor} · {room.name} <span className="text-xs text-ink-faint">{room.area.toFixed(1)} m²</span></label>
            <select id={`finish-${room.id}`} value={selection.roomFloors[room.id] ?? ''} onChange={e => {
              const roomFloors = { ...selection.roomFloors }; if (e.target.value) roomFloors[room.id] = e.target.value; else delete roomFloors[room.id]
              update({ roomFloors })
            }} className="border border-line bg-bg px-3 py-2 text-sm"><option value="">Use overall flooring</option>
              {catalog.categories.find(c => c.id === 'floor')!.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          </div>)}</div>
        </details>
        <details className="mt-5 border-t border-line pt-5"><summary className="cursor-pointer text-sm">Allowances & tax provision</summary>
          <p className="mt-3 text-xs leading-relaxed text-ink-dim">Default allowances are already included. GST is excluded until you confirm the contractor’s tax treatment.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">{([
            ['overheadPercent', 'Contractor overhead (%)'], ['contingencyPercent', 'Contingency (%)'], ['feePercent', 'Professional fees (%)'], ['gstPercent', 'GST provision (%)'],
          ] as const).map(([field, label]) => <Field key={field} label={label}><input aria-label={label} type="number" min={0} max={policy.percentageLimit}
            value={selection[field]} onChange={e => { if (e.target.value !== '') update({ [field]: Number(e.target.value) }) }} className="w-full border border-line bg-bg px-3 py-2 text-sm" /></Field>)}</div>
          <label className="mt-4 flex items-center gap-3 text-sm"><input type="checkbox" checked={selection.includeGst} onChange={e => update({ includeGst: e.target.checked })} />Include the GST provision</label>
        </details>
      </div>
      <aside className="min-w-0 lg:sticky lg:top-6"><CostSummary cost={cost} />
        <Link to="/workspace/report" className="mt-6 block bg-accent px-5 py-3 text-center text-sm text-white hover:bg-accent-hot">Continue to Report</Link>
        <Link to="/workspace/render" className="mt-4 block text-center text-xs text-ink-dim underline">Back to Render</Link></aside>
    </div>
    <details className="mt-10 border-t border-line pt-5"><summary className="cursor-pointer text-sm">Itemised quantities & rates (BOQ)</summary>
      <BoqTable cost={cost} /><button type="button" onClick={download} className="mt-5 border border-line-strong px-4 py-2 text-sm">Download BOQ CSV</button>
    </details>
  </div>
}
